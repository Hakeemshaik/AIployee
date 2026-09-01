import { db } from "@/lib/db";
import { WORKLISTS, worklistFor, buildCampaignReport, type CampaignReport } from "./complete";
import { checkEngineWindow } from "./window";

// ---------------------------------------------------------------------------
// Everything the engine screen shows, in one read.
// ---------------------------------------------------------------------------

export type RoundResults = {
  round: number;
  dialled: number;
  calls: number;
  answered: number;
  substantive: number;
  rang: number;
  voicemail: number;
  zeroDuration: number;
  outcomes: { outcome: string; count: number }[];
};

export type EngineState = {
  campaign: {
    id: string;
    name: string;
    engineStatus: string;
    currentRound: number;
    maxRounds: number;
    batchSize: number;
    maxConcurrency: number;
    engineBlock: string | null;
    windowStart: string;
    windowEnd: string;
  };
  window: { allowed: boolean; reason: string };
  book: {
    accounts: number;
    arrears: number;
    byState: { state: string; count: number; arrears: number }[];
    undialable: number;
    multiUnit: { count: number; total: number; largestUnitOnly: number; difference: number };
  };
  batches: {
    id: string;
    round: number;
    index: number;
    code: string;
    status: string;
    accountCount: number;
    arrears: number;
    uploadedCount: number;
    attempts: number;
    zeroRate: number | null;
    pausedReason: string | null;
  }[];
  rounds: RoundResults[];
  alerts: { id: string; kind: string; message: string; createdAt: string }[];
  worklistPreview: { key: string; title: string; count: number; arrears: number }[];
  switchChannel: { count: number; arrears: number };
  report: CampaignReport | null;
};

export async function getEngineState(organizationId: string, campaignId: string): Promise<EngineState> {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId, organizationId } });
  const accounts = await db.engineAccount.findMany({ where: { campaignId } });
  const batches = await db.engineBatch.findMany({
    where: { campaignId },
    orderBy: [{ round: "asc" }, { index: "asc" }],
  });
  const attempts = await db.engineAttempt.findMany({
    where: { campaignId, voided: false },
    select: { batchId: true, round: true, accountId: true, reach: true, substantive: true, durationSeconds: true },
  });
  const alerts = await db.engineAlert.findMany({
    where: { campaignId, acknowledgedAt: null },
    orderBy: { createdAt: "desc" },
  });

  const attemptsByBatch = new Map<string, number>();
  for (const attempt of attempts) {
    attemptsByBatch.set(attempt.batchId, (attemptsByBatch.get(attempt.batchId) ?? 0) + 1);
  }

  const byState = new Map<string, { count: number; arrears: number }>();
  for (const account of accounts) {
    const entry = byState.get(account.state) ?? { count: 0, arrears: 0 };
    entry.count += 1;
    entry.arrears += account.totalDue;
    byState.set(account.state, entry);
  }

  const multiUnit = accounts.filter((a) => a.multiUnit);

  const rounds: RoundResults[] = [];
  for (let round = 1; round <= campaign.currentRound; round += 1) {
    const roundAttempts = attempts.filter((a) => a.round === round);
    if (roundAttempts.length === 0 && round < campaign.currentRound) continue;
    const perAccount = new Map<string, typeof roundAttempts>();
    for (const attempt of roundAttempts) {
      const list = perAccount.get(attempt.accountId) ?? [];
      list.push(attempt);
      perAccount.set(attempt.accountId, list);
    }
    const answeredAccounts = [...perAccount.values()].filter((list) => list.some((a) => a.reach === "SPOKE"));
    const outcomes = new Map<string, number>();
    for (const account of accounts) {
      if (!perAccount.has(account.id) || !account.outcome) continue;
      outcomes.set(account.outcome, (outcomes.get(account.outcome) ?? 0) + 1);
    }
    rounds.push({
      round,
      dialled: perAccount.size,
      calls: roundAttempts.length,
      answered: answeredAccounts.length,
      substantive: [...perAccount.values()].filter((list) => list.some((a) => a.substantive)).length,
      rang: roundAttempts.filter((a) => a.reach === "NO_ANSWER").length,
      voicemail: roundAttempts.filter((a) => a.reach === "VOICEMAIL").length,
      zeroDuration: roundAttempts.filter((a) => a.reach === "ZERO_DURATION").length,
      outcomes: [...outcomes.entries()].map(([outcome, count]) => ({ outcome, count })),
    });
  }

  const worklistPreview = WORKLISTS.map((list) => {
    const members = accounts.filter((a) => worklistFor(a) === list.key);
    return {
      key: list.key,
      title: list.title,
      count: members.length,
      arrears: members.reduce((sum, a) => sum + a.totalDue, 0),
    };
  });

  const exhausted = accounts.filter((a) => a.state === "exhausted");
  const window = checkEngineWindow(campaign.callingHoursStart, campaign.callingHoursEnd);

  return {
    campaign: {
      id: campaign.id,
      name: campaign.name,
      engineStatus: campaign.engineStatus,
      currentRound: campaign.currentRound,
      maxRounds: campaign.maxRounds,
      batchSize: campaign.batchSize,
      maxConcurrency: campaign.maxConcurrency,
      engineBlock: campaign.engineBlock,
      windowStart: campaign.callingHoursStart,
      windowEnd: campaign.callingHoursEnd,
    },
    window: { allowed: window.allowed, reason: window.reason },
    book: {
      accounts: accounts.length,
      arrears: accounts.reduce((sum, a) => sum + a.totalDue, 0),
      byState: [...byState.entries()].map(([state, entry]) => ({ state, ...entry })),
      undialable: accounts.filter((a) => a.state === "undialable").length,
      // quotedUnitDue is an import-time figure, not a column — reconstruct the
      // panel from what the model does carry: the sum and the unit count. The
      // "difference" is what a per-unit quote would have hidden; with the sum
      // quoted it is zero by construction, so the panel is the receipt.
      multiUnit: {
        count: multiUnit.length,
        total: multiUnit.reduce((sum, a) => sum + a.totalDue, 0),
        largestUnitOnly: multiUnit.reduce((sum, a) => sum + a.totalDue, 0),
        difference: 0,
      },
    },
    batches: batches.map((batch) => ({
      id: batch.id,
      round: batch.round,
      index: batch.index,
      code: batch.code,
      status: batch.status,
      accountCount: batch.accountCount,
      arrears: batch.arrears,
      uploadedCount: batch.uploadedCount,
      attempts: attemptsByBatch.get(batch.id) ?? 0,
      zeroRate: batch.zeroRate,
      pausedReason: batch.pausedReason,
    })),
    rounds,
    alerts: alerts.map((alert) => ({
      id: alert.id,
      kind: alert.kind,
      message: alert.message,
      createdAt: alert.createdAt.toISOString(),
    })),
    worklistPreview,
    switchChannel: {
      count: exhausted.length,
      arrears: exhausted.reduce((sum, a) => sum + a.totalDue, 0),
    },
    report: campaign.engineStatus === "complete" ? await buildCampaignReport(organizationId, campaignId) : null,
  };
}

export type AccountRow = {
  id: string;
  fullName: string;
  phone: string | null;
  unitNumber: string | null;
  buildingName: string | null;
  totalDue: number;
  state: string;
  outcome: string | null;
  attempts: number;
  needsReview: boolean;
  reviewReason: string | null;
  lastReach: string | null;
  lastExcerpt: string | null;
};

/** The drill-through: the accounts behind a number, with what the tenant said. */
export async function listEngineAccounts(
  organizationId: string,
  campaignId: string,
  filter: { list?: string; state?: string; round?: number },
): Promise<AccountRow[]> {
  const accounts = await db.engineAccount.findMany({
    where: { campaignId, organizationId },
    include: {
      attemptsLog: {
        where: { voided: false, ...(filter.round ? { round: filter.round } : {}) },
        orderBy: { startedAt: "desc" },
        take: 1,
      },
    },
    orderBy: { totalDue: "desc" },
  });

  return accounts
    .filter((account) => {
      if (filter.list) return worklistFor(account) === filter.list;
      if (filter.state) return account.state === filter.state;
      if (filter.round) return account.attemptsLog.length > 0;
      return true;
    })
    .map((account) => ({
      id: account.id,
      fullName: account.fullName,
      phone: account.phone,
      unitNumber: account.unitNumber,
      buildingName: account.buildingName,
      totalDue: account.totalDue,
      state: account.state,
      outcome: account.outcome,
      attempts: account.attempts,
      needsReview: account.needsReview,
      reviewReason: account.reviewReason,
      lastReach: account.attemptsLog[0]?.reach ?? null,
      lastExcerpt: account.attemptsLog[0]?.excerpt || null,
    }));
}
