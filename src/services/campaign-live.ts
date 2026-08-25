import { db } from "@/lib/db";
import { UNREACHED_OUTCOMES } from "@/lib/domain";
import { redialCounts } from "@/services/redial";

// ---------------------------------------------------------------------------
// Live campaign state — the numbers behind the command centre view.
//
// Everything is derived from stored records (calls, contacts, promises), so a
// refresh, a webhook and a poll all agree. The SSE stream sends this same
// payload whenever it changes, so the page updates without reloading.
// ---------------------------------------------------------------------------

export type LiveActivityItem = {
  id: string;
  at: Date;
  phone: string;
  debtorId: string;
  debtorName: string;
  status: string;
  outcome: string | null;
  promisedAmount: number | null;
  durationSeconds: number;
};

export type CampaignLiveState = {
  status: string;
  providerCampaignId: string | null;
  providerError: string | null;
  totals: {
    contacts: number;
    attempted: number;
    inFlight: number;
    answered: number;
    noAnswer: number;
    busy: number;
    failed: number;
    completed: number;
  };
  outcomes: { outcome: string; count: number }[];
  promises: {
    count: number;
    value: number;
    kept: number;
    pending: number;
    broken: number;
    fulfilmentRate: number;
  };
  redial: Record<string, number>;
  activity: LiveActivityItem[];
  batches: {
    id: string;
    filter: string;
    contactCount: number;
    status: string;
    createdAt: Date;
    providerError: string | null;
  }[];
  /** Changes whenever anything above changes — used to skip idle SSE sends. */
  revision: string;
};

/** A call is "in flight" when it started very recently and has no end time. */
const IN_FLIGHT_WINDOW_MS = 5 * 60_000;

export async function getCampaignLiveState(
  organizationId: string,
  campaignId: string,
): Promise<CampaignLiveState | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      id: true,
      status: true,
      providerCampaignId: true,
      providerError: true,
      maxAttempts: true,
    },
  });
  if (!campaign) return null;

  const [contactCount, calls, analyses, promises, batches, recent] = await Promise.all([
    db.campaignContact.count({ where: { organizationId, campaignId } }),
    db.call.findMany({
      where: { organizationId, campaignId },
      select: { id: true, status: true, debtorId: true, startedAt: true, endedAt: true },
    }),
    db.callAnalysis.findMany({
      where: { organizationId, call: { campaignId } },
      select: { outcome: true },
    }),
    db.promiseToPay.findMany({
      where: { organizationId, campaignId },
      select: { amount: true, status: true },
    }),
    db.redialBatch.findMany({
      where: { organizationId, campaignId },
      orderBy: { createdAt: "desc" },
      take: 8,
      select: { id: true, filter: true, contactCount: true, status: true, createdAt: true, providerError: true },
    }),
    db.call.findMany({
      where: { organizationId, campaignId },
      orderBy: { startedAt: "desc" },
      take: 15,
      select: {
        id: true,
        startedAt: true,
        status: true,
        durationSeconds: true,
        debtor: { select: { id: true, firstName: true, lastName: true, phone: true } },
        analysis: { select: { outcome: true, promisedAmount: true } },
      },
    }),
  ]);

  const now = Date.now();
  const totals = {
    contacts: contactCount,
    attempted: calls.length,
    inFlight: calls.filter(
      (c) => !c.endedAt && now - c.startedAt.getTime() < IN_FLIGHT_WINDOW_MS,
    ).length,
    answered: calls.filter((c) => c.status === "completed").length,
    noAnswer: calls.filter((c) => c.status === "no_answer" || c.status === "voicemail").length,
    busy: calls.filter((c) => c.status === "busy").length,
    failed: calls.filter((c) => c.status === "failed").length,
    completed: calls.filter((c) => c.endedAt !== null).length,
  };

  const outcomeCounts: Record<string, number> = {};
  for (const a of analyses) {
    if (UNREACHED_OUTCOMES.includes(a.outcome as (typeof UNREACHED_OUTCOMES)[number])) continue;
    outcomeCounts[a.outcome] = (outcomeCounts[a.outcome] ?? 0) + 1;
  }

  const kept = promises.filter((p) => p.status === "fulfilled").length;
  const broken = promises.filter((p) => p.status === "broken").length;

  const state: Omit<CampaignLiveState, "revision"> = {
    status: campaign.status,
    providerCampaignId: campaign.providerCampaignId,
    providerError: campaign.providerError,
    totals,
    outcomes: Object.entries(outcomeCounts)
      .map(([outcome, count]) => ({ outcome, count }))
      .sort((a, b) => b.count - a.count),
    promises: {
      count: promises.length,
      value: Math.round(promises.reduce((s, p) => s + p.amount, 0)),
      kept,
      pending: promises.filter((p) => p.status === "pending").length,
      broken,
      fulfilmentRate: kept + broken > 0 ? kept / (kept + broken) : 0,
    },
    redial: await redialCounts(organizationId, campaignId, campaign.maxAttempts),
    activity: recent.map((c) => ({
      id: c.id,
      at: c.startedAt,
      phone: c.debtor.phone,
      debtorId: c.debtor.id,
      debtorName: `${c.debtor.firstName} ${c.debtor.lastName}`,
      status: c.status,
      outcome: c.analysis?.outcome ?? null,
      promisedAmount: c.analysis?.promisedAmount ?? null,
      durationSeconds: c.durationSeconds,
    })),
    batches,
  };

  return {
    ...state,
    revision: [
      campaign.status,
      totals.attempted,
      totals.answered,
      totals.inFlight,
      state.promises.count,
      state.promises.value,
      recent[0]?.id ?? "",
      batches[0]?.id ?? "",
    ].join("|"),
  };
}
