import { db } from "@/lib/db";
import { riskBand } from "@/lib/domain";
import { startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// Debtor service. All queries are organization-scoped. List filtering that
// depends on aggregated account values (amount, days overdue) is applied in
// memory after the scoped fetch — acceptable at MVP book sizes and swapped
// for SQL aggregation when the book grows.
// ---------------------------------------------------------------------------

export type DebtorFilters = {
  search?: string;
  status?: string;
  campaignId?: string;
  risk?: "low" | "medium" | "high";
  minAmount?: number;
  maxAmount?: number;
  minDaysOverdue?: number;
  maxDaysOverdue?: number;
  lastContactDays?: number; // contacted within N days
  promiseStatus?: "has_open" | "overdue" | "none";
};

export type DebtorRow = {
  id: string;
  name: string;
  accountNumber: string;
  phone: string;
  outstanding: number;
  daysOverdue: number;
  lastContactAt: Date | null;
  lastOutcome: string | null;
  promiseAmount: number | null;
  promiseDate: Date | null;
  status: string;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  campaignName: string | null;
};

export async function listDebtors(
  organizationId: string,
  filters: DebtorFilters = {},
): Promise<DebtorRow[]> {
  const debtors = await db.debtor.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.search
        ? {
            OR: [
              { firstName: { contains: filters.search } },
              { lastName: { contains: filters.search } },
              { accountNumber: { contains: filters.search } },
              { phone: { contains: filters.search.replace(/[\s()-]/g, "") } },
            ],
          }
        : {}),
    },
    include: {
      accounts: { select: { currentBalance: true, daysOverdue: true } },
      campaign: { select: { name: true } },
      promises: {
        where: { status: "pending" },
        orderBy: { promisedDate: "asc" },
        take: 1,
        select: { amount: true, promisedDate: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const today = startOfDay(new Date());
  let rows: DebtorRow[] = debtors.map((d) => {
    const outstanding = d.accounts.reduce((s, a) => s + a.currentBalance, 0);
    const daysOverdue = Math.max(0, ...d.accounts.map((a) => a.daysOverdue));
    const openPromise = d.promises[0] ?? null;
    return {
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      accountNumber: d.accountNumber,
      phone: d.phone,
      outstanding,
      daysOverdue,
      lastContactAt: d.lastContactAt,
      lastOutcome: d.lastOutcome,
      promiseAmount: openPromise?.amount ?? null,
      promiseDate: openPromise?.promisedDate ?? null,
      status: d.status,
      riskScore: d.riskScore,
      riskBand: riskBand(d.riskScore),
      campaignName: d.campaign?.name ?? null,
    };
  });

  if (filters.risk) rows = rows.filter((r) => r.riskBand === filters.risk);
  if (filters.minAmount != null) rows = rows.filter((r) => r.outstanding >= filters.minAmount!);
  if (filters.maxAmount != null) rows = rows.filter((r) => r.outstanding <= filters.maxAmount!);
  if (filters.minDaysOverdue != null) rows = rows.filter((r) => r.daysOverdue >= filters.minDaysOverdue!);
  if (filters.maxDaysOverdue != null) rows = rows.filter((r) => r.daysOverdue <= filters.maxDaysOverdue!);
  if (filters.lastContactDays != null) {
    const cutoff = new Date(Date.now() - filters.lastContactDays * 86_400_000);
    rows = rows.filter((r) => r.lastContactAt && r.lastContactAt >= cutoff);
  }
  if (filters.promiseStatus === "has_open") rows = rows.filter((r) => r.promiseAmount != null);
  if (filters.promiseStatus === "overdue") {
    rows = rows.filter((r) => r.promiseDate && startOfDay(r.promiseDate) < today);
  }
  if (filters.promiseStatus === "none") rows = rows.filter((r) => r.promiseAmount == null);

  return rows;
}

export type TimelineEntry = {
  id: string;
  at: Date;
  kind: "call" | "sms" | "promise" | "payment" | "escalation";
  title: string;
  detail: string | null;
  outcome?: string | null;
  callStatus?: string | null;
  amount?: number | null;
  date?: Date | null;
  href?: string;
};

export async function getDebtorProfile(organizationId: string, debtorId: string) {
  const debtor = await db.debtor.findFirst({
    where: { id: debtorId, organizationId },
    include: {
      accounts: true,
      campaign: { select: { id: true, name: true } },
      calls: {
        orderBy: { startedAt: "desc" },
        include: { analysis: true, agent: { select: { name: true } } },
      },
      promises: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { paidAt: "desc" } },
      escalations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!debtor) return null;

  const smsEvents = await db.platformEvent.findMany({
    where: { organizationId, type: "sms.sent", entityId: debtorId },
    orderBy: { createdAt: "desc" },
  });

  const timeline: TimelineEntry[] = [
    ...debtor.calls.map((c) => ({
      id: `call-${c.id}`,
      at: c.startedAt,
      kind: "call" as const,
      title: "AI call",
      callStatus: c.status,
      outcome: c.analysis?.outcome ?? c.outcome,
      detail: c.analysis?.summary ?? null,
      amount: c.analysis?.promisedAmount ?? null,
      date: c.analysis?.promisedDate ?? null,
      href: `/calls/${c.id}`,
    })),
    ...smsEvents.map((e) => ({
      id: `sms-${e.id}`,
      at: e.createdAt,
      kind: "sms" as const,
      title: "SMS sent",
      detail: e.payload ? (JSON.parse(e.payload).template ?? null) : null,
    })),
    ...debtor.promises.map((p) => ({
      id: `promise-${p.id}`,
      at: p.createdAt,
      kind: "promise" as const,
      title: "Promise to pay recorded",
      detail: null,
      outcome: p.status,
      amount: p.amount,
      date: p.promisedDate,
    })),
    ...debtor.payments.map((p) => ({
      id: `payment-${p.id}`,
      at: p.paidAt,
      kind: "payment" as const,
      title: "Payment received",
      detail: p.reference,
      outcome: p.status,
      amount: p.amount,
    })),
    ...debtor.escalations.map((e) => ({
      id: `escalation-${e.id}`,
      at: e.createdAt,
      kind: "escalation" as const,
      title: "Escalated to human collector",
      detail: e.notes,
      outcome: e.reason,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const outstanding = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
  const originalBalance = debtor.accounts.reduce((s, a) => s + a.originalBalance, 0);
  const amountPaid = debtor.accounts.reduce((s, a) => s + a.amountPaid, 0);
  const connectedCalls = debtor.calls.filter((c) => c.status === "completed");

  return {
    debtor,
    timeline,
    stats: {
      outstanding,
      originalBalance,
      amountPaid,
      daysOverdue: Math.max(0, ...debtor.accounts.map((a) => a.daysOverdue)),
      dueDate: debtor.accounts[0]?.dueDate ?? null,
      contactAttempts: debtor.calls.length,
      successfulContacts: connectedCalls.length,
      riskBand: riskBand(debtor.riskScore),
      openPromise: debtor.promises.find((p) => p.status === "pending") ?? null,
    },
  };
}

/** Distinct campaigns for filter dropdowns. */
export async function listCampaignOptions(organizationId: string) {
  return db.campaign.findMany({
    where: { organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
