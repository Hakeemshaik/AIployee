import { db } from "@/lib/db";
import { startOfDay } from "@/lib/format";
import { getAIProvider } from "@/services/ai";
import type { CollectionInsights, CollectionSnapshot } from "@/services/ai";

// ---------------------------------------------------------------------------
// Insight service — builds the aggregated, anonymised data snapshot the AI
// layer consumes, and manages stored AIInsight records. No debtor PII (names,
// phone numbers, transcripts) ever enters a snapshot.
// ---------------------------------------------------------------------------

export async function buildCollectionSnapshot(
  organizationId: string,
  options: { periodStart?: Date; periodEnd?: Date; campaignId?: string } = {},
): Promise<CollectionSnapshot> {
  const periodEnd = options.periodEnd ?? new Date();
  const periodStart = options.periodStart ?? new Date(periodEnd.getTime() - 30 * 86_400_000);
  const campaignFilter = options.campaignId ? { campaignId: options.campaignId } : {};

  const org = await db.organization.findUniqueOrThrow({ where: { id: organizationId } });

  const [accounts, payments, calls, analyses, promises, escalations, campaigns] =
    await Promise.all([
      db.debtAccount.findMany({
        where: {
          organizationId,
          ...(options.campaignId ? { debtor: { campaignId: options.campaignId } } : {}),
        },
        select: { currentBalance: true, amountPaid: true, daysOverdue: true, debtorId: true },
      }),
      db.payment.findMany({
        where: {
          organizationId,
          status: "completed",
          paidAt: { gte: periodStart, lte: periodEnd },
          ...campaignFilter,
        },
        select: { amount: true, debtorId: true },
      }),
      db.call.findMany({
        where: {
          organizationId,
          startedAt: { gte: periodStart, lte: periodEnd },
          ...campaignFilter,
        },
        select: { status: true, debtorId: true },
      }),
      db.callAnalysis.findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...(options.campaignId ? { call: { campaignId: options.campaignId } } : {}),
        },
        select: { outcome: true, sentiment: true, reasonForNonpayment: true },
      }),
      // Promises created in the window, plus promises still open now — an open
      // promise made before the window is still live risk in this period.
      db.promiseToPay.findMany({
        where: {
          organizationId,
          OR: [{ createdAt: { gte: periodStart, lte: periodEnd } }, { status: "pending" }],
          ...campaignFilter,
        },
        select: { amount: true, status: true, promisedDate: true, createdAt: true },
      }),
      db.escalation.findMany({
        where: {
          organizationId,
          createdAt: { gte: periodStart, lte: periodEnd },
          ...campaignFilter,
        },
        select: { reason: true },
      }),
      db.campaign.findMany({
        where: { organizationId, ...(options.campaignId ? { id: options.campaignId } : {}) },
        include: {
          debtors: { select: { id: true, accounts: { select: { currentBalance: true } } } },
          calls: { select: { status: true, debtorId: true } },
          promises: { select: { amount: true, status: true } },
          payments: { where: { status: "completed" }, select: { amount: true } },
        },
      }),
    ]);

  const totalOutstanding = accounts.reduce((s, a) => s + a.currentBalance, 0);
  const totalRecovered = payments.reduce((s, p) => s + p.amount, 0);
  const contactedDebtors = new Set(calls.map((c) => c.debtorId));
  const connectedDebtors = new Set(calls.filter((c) => c.status === "completed").map((c) => c.debtorId));
  const connectedCalls = calls.filter((c) => c.status === "completed").length;

  const count = (items: (string | null)[]) => {
    const out: Record<string, number> = {};
    for (const item of items) if (item) out[item] = (out[item] ?? 0) + 1;
    return out;
  };

  const today = startOfDay(new Date());
  const inWindow = promises.filter((p) => p.createdAt >= periodStart && p.createdAt <= periodEnd);
  const fulfilled = inWindow.filter((p) => p.status === "fulfilled").length;
  const broken = inWindow.filter((p) => p.status === "broken").length;
  const pending = promises.filter((p) => p.status === "pending").length;
  const overdue = promises.filter(
    (p) => p.status === "pending" && startOfDay(p.promisedDate) < today,
  ).length;

  // Aging buckets over the debt book, with recovery + contact per bucket.
  const paymentsByDebtor = new Map<string, number>();
  for (const p of payments) {
    paymentsByDebtor.set(p.debtorId, (paymentsByDebtor.get(p.debtorId) ?? 0) + p.amount);
  }
  const buckets = [
    { bucket: "0-30", min: 0, max: 30 },
    { bucket: "31-60", min: 31, max: 60 },
    { bucket: "61-90", min: 61, max: 90 },
    { bucket: "90+", min: 91, max: Infinity },
  ].map(({ bucket, min, max }) => {
    const inBucket = accounts.filter((a) => a.daysOverdue >= min && a.daysOverdue <= max);
    const debtorIds = new Set(inBucket.map((a) => a.debtorId));
    const contacted = [...debtorIds].filter((id) => contactedDebtors.has(id)).length;
    return {
      bucket,
      debtors: debtorIds.size,
      outstanding: Math.round(inBucket.reduce((s, a) => s + a.currentBalance, 0)),
      recovered: Math.round(
        [...debtorIds].reduce((s, id) => s + (paymentsByDebtor.get(id) ?? 0), 0),
      ),
      contactRate: debtorIds.size ? contacted / debtorIds.size : 0,
    };
  });

  return {
    organizationName: org.name,
    currency: org.currency,
    periodStart: periodStart.toISOString(),
    periodEnd: periodEnd.toISOString(),
    totals: {
      totalOutstanding: Math.round(totalOutstanding),
      totalRecovered: Math.round(totalRecovered),
      recoveryRate: totalOutstanding + totalRecovered > 0 ? totalRecovered / (totalOutstanding + totalRecovered) : 0,
      debtorCount: new Set(accounts.map((a) => a.debtorId)).size,
      debtorsContacted: contactedDebtors.size,
      successfulContacts: connectedDebtors.size,
      totalCallAttempts: calls.length,
      connectRate: calls.length ? connectedCalls / calls.length : 0,
    },
    outcomes: count(analyses.map((a) => a.outcome)),
    reasonsForNonpayment: count(analyses.map((a) => a.reasonForNonpayment)),
    sentiment: count(analyses.map((a) => a.sentiment)),
    promises: {
      total: inWindow.length,
      totalValue: Math.round(inWindow.reduce((s, p) => s + p.amount, 0)),
      fulfilled,
      broken,
      pending,
      overdue,
      fulfilmentRate: fulfilled + broken > 0 ? fulfilled / (fulfilled + broken) : 0,
    },
    payments: {
      count: payments.length,
      totalValue: Math.round(totalRecovered),
      averageValue: payments.length ? Math.round(totalRecovered / payments.length) : 0,
    },
    agingBuckets: buckets,
    campaigns: campaigns.map((c) => {
      const outstanding = c.debtors.reduce(
        (s, d) => s + d.accounts.reduce((s2, a) => s2 + a.currentBalance, 0),
        0,
      );
      const recovered = c.payments.reduce((s, p) => s + p.amount, 0);
      return {
        name: c.name,
        status: c.status,
        strategy: c.strategy,
        debtors: c.debtors.length,
        contacted: new Set(c.calls.map((x) => x.debtorId)).size,
        connected: new Set(c.calls.filter((x) => x.status === "completed").map((x) => x.debtorId)).size,
        promises: c.promises.length,
        promiseValue: Math.round(c.promises.reduce((s, p) => s + p.amount, 0)),
        recovered: Math.round(recovered),
        outstanding: Math.round(outstanding),
        recoveryRate: outstanding + recovered > 0 ? recovered / (outstanding + recovered) : 0,
      };
    }),
    escalations: count(escalations.map((e) => e.reason)),
  };
}

/** Latest stored insight for a scope, or null. */
export async function getLatestInsight(organizationId: string, scope: string) {
  const row = await db.aIInsight.findFirst({
    where: { organizationId, scope },
    orderBy: { generatedAt: "desc" },
  });
  if (!row) return null;
  return {
    id: row.id,
    provider: row.provider,
    generatedAt: row.generatedAt,
    content: JSON.parse(row.content) as CollectionInsights,
  };
}

/** Build a fresh snapshot, run the AI provider over it, and store the result. */
export async function generateInsights(
  organizationId: string,
  scope: "dashboard" | "insights" | "campaign" = "insights",
  options: { periodDays?: number; refId?: string } = {},
) {
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - (options.periodDays ?? 30) * 86_400_000);
  const snapshot = await buildCollectionSnapshot(organizationId, {
    periodStart,
    periodEnd,
    campaignId: scope === "campaign" ? options.refId : undefined,
  });
  const provider = await getAIProvider();
  const content = await provider.generateCollectionInsights(snapshot);
  const row = await db.aIInsight.create({
    data: {
      organizationId,
      scope,
      refId: options.refId,
      content: JSON.stringify(content),
      provider: provider.name,
      dataWindowStart: periodStart,
      dataWindowEnd: periodEnd,
    },
  });
  return { id: row.id, provider: row.provider, generatedAt: row.generatedAt, content };
}
