import type { EngineAccount } from "@prisma/client";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { markDeadNumbers } from "./classify";

// ---------------------------------------------------------------------------
// Closing a campaign.
//
// Complete is allowed once every account has landed somewhere final —
// resolved, exhausted or undialable — and completing FREEZES it: no further
// dialling, ever. What comes out is the client report and the worklists, and
// neither is allowed off the premises until it reconciles: worklist rows must
// sum to the account count and worklist arrears to the book value, exactly.
// A report that does not add up is worse than no report.
// ---------------------------------------------------------------------------

export const WORKLISTS = [
  { key: "promises", title: "Promises to chase" },
  { key: "disputes", title: "Disputes & paid claims to verify" },
  { key: "callbacks", title: "Callbacks due" },
  { key: "office", title: "Office arrangements to verify" },
  { key: "refused", title: "Refused & escalated" },
  { key: "no_outcome", title: "Answered, no outcome" },
  { key: "wrong", title: "Wrong numbers" },
  { key: "dead", title: "Dead numbers" },
  { key: "never_answered", title: "Never answered" },
  { key: "no_contact", title: "No contact number" },
] as const;

export type WorklistKey = (typeof WORKLISTS)[number]["key"];

/**
 * Exactly one list per account — checked in priority order so the partition
 * is total and exclusive by construction, which is what makes the
 * reconciliation an identity rather than a hope.
 */
export function worklistFor(account: EngineAccount): WorklistKey {
  if (!account.phone) return "no_contact";
  switch (account.outcome) {
    case "PTP":
    case "PART":
      return "promises";
    case "DISPUTE":
    case "PAID":
      return "disputes";
    case "CALLBACK":
      return "callbacks";
    case "OFFICE":
      return "office";
    case "REFUSED":
    case "ESCALATED":
      return "refused";
    case "WRONG":
      return "wrong";
    default:
      break;
  }
  if (account.state === "undialable") return "dead";
  if (account.state === "reached" || account.outcome === "NO_OUTCOME" || account.needsReview) {
    return "no_outcome";
  }
  return "never_answered";
}

export type CampaignReport = {
  campaign: { id: string; name: string; rounds: number };
  perAccount: true;
  accounts: number;
  bookValue: number;
  calls: number;
  attemptsPerAccount: number;
  dialled: number;
  reached: number;
  rightPartyContactRate: number;
  substantive: number;
  ptpCount: number;
  /** PTP as a share of reached accounts — contacts, never calls. */
  ptpRate: number;
  /** What the committing tenants owe in total. NOT what they agreed to pay. */
  arrearsUnderCommitment: number;
  /** What they actually agreed to pay, where a figure was stated. ~3× smaller
   *  than the line above on real books; conflating them flatters the result. */
  cashCommitted: number;
  commitmentsWithoutAmount: number;
  worklists: { key: WorklistKey; title: string; count: number; arrears: number }[];
  reconciled: boolean;
  switchChannel: { count: number; arrears: number };
};

/** A promised amount, read from the tenant's own words where one was stated. */
function promisedAmount(excerpt: string): number | null {
  const match = /R\s?([\d][\d\s,]{1,12})(?:\.\d{1,2})?/.exec(excerpt);
  if (!match) return null;
  const value = Number(match[1].replace(/[\s,]/g, ""));
  return Number.isFinite(value) && value >= 50 ? Math.round(value) : null;
}

export async function buildCampaignReport(
  organizationId: string,
  campaignId: string,
): Promise<CampaignReport> {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId, organizationId } });
  const accounts = await db.engineAccount.findMany({ where: { campaignId } });
  const attempts = await db.engineAttempt.findMany({
    where: { campaignId, voided: false },
    select: { accountId: true, reach: true, substantive: true, excerpt: true },
  });

  const byAccount = new Map<string, typeof attempts>();
  for (const attempt of attempts) {
    const list = byAccount.get(attempt.accountId) ?? [];
    list.push(attempt);
    byAccount.set(attempt.accountId, list);
  }

  const dialled = accounts.filter((a) => (byAccount.get(a.id)?.length ?? 0) > 0);
  const reached = accounts.filter((a) => byAccount.get(a.id)?.some((x) => x.reach === "SPOKE"));
  const substantive = accounts.filter((a) => byAccount.get(a.id)?.some((x) => x.substantive));
  const committed = accounts.filter((a) => a.outcome === "PTP" || a.outcome === "PART");

  let cashCommitted = 0;
  let withoutAmount = 0;
  for (const account of committed) {
    const words = byAccount.get(account.id)?.map((x) => x.excerpt).join(" ") ?? "";
    const amount = promisedAmount(words);
    if (amount === null) withoutAmount += 1;
    // A stated figure above the balance is a transcription artefact, not a
    // windfall; cap at what is owed.
    else cashCommitted += Math.min(amount, account.totalDue);
  }

  const lists = WORKLISTS.map((list) => {
    const members = accounts.filter((a) => worklistFor(a) === list.key);
    return {
      key: list.key,
      title: list.title,
      count: members.length,
      arrears: members.reduce((sum, a) => sum + a.totalDue, 0),
    };
  });

  const bookValue = accounts.reduce((sum, a) => sum + a.totalDue, 0);
  const reconciled =
    lists.reduce((sum, l) => sum + l.count, 0) === accounts.length &&
    lists.reduce((sum, l) => sum + l.arrears, 0) === bookValue;

  const exhausted = accounts.filter((a) => a.state === "exhausted");

  return {
    campaign: { id: campaign.id, name: campaign.name, rounds: campaign.currentRound },
    perAccount: true,
    accounts: accounts.length,
    bookValue,
    calls: attempts.length,
    attemptsPerAccount: dialled.length > 0 ? attempts.length / dialled.length : 0,
    dialled: dialled.length,
    reached: reached.length,
    rightPartyContactRate: dialled.length > 0 ? reached.length / dialled.length : 0,
    substantive: substantive.length,
    ptpCount: committed.length,
    ptpRate: reached.length > 0 ? committed.length / reached.length : 0,
    arrearsUnderCommitment: committed.reduce((sum, a) => sum + a.totalDue, 0),
    cashCommitted,
    commitmentsWithoutAmount: withoutAmount,
    worklists: lists,
    reconciled,
    switchChannel: {
      count: exhausted.length,
      arrears: exhausted.reduce((sum, a) => sum + a.totalDue, 0),
    },
  };
}

/**
 * Freeze the campaign. Refuses while anybody is still in play, and runs the
 * dead-number rule first so "undialable" is decided by the cross-checked test,
 * never by zero-duration alone.
 */
export async function completeCampaign(
  organizationId: string,
  campaignId: string,
  userId: string,
): Promise<CampaignReport> {
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: campaignId, organizationId } });
  if (campaign.engineStatus === "complete") return buildCampaignReport(organizationId, campaignId);
  if (!["between_rounds", "review", "ready"].includes(campaign.engineStatus)) {
    throw new Error(`The campaign cannot be completed while it is ${campaign.engineStatus}.`);
  }

  await markDeadNumbers(organizationId, campaignId);

  const open = await db.engineAccount.count({
    where: { campaignId, state: { notIn: ["resolved", "exhausted", "undialable"] } },
  });
  if (open > 0) {
    // The accounts still in play either get another round or hit the cap.
    // Reaching the cap is what moves them to exhausted; completing early would
    // hide live work inside a frozen campaign.
    const cap = campaign.currentRound >= campaign.maxRounds;
    if (!cap) {
      throw new Error(
        `${open} account(s) are still in play. Run another round, or wait for the attempt cap (round ${campaign.currentRound} of ${campaign.maxRounds}).`,
      );
    }
    await db.engineAccount.updateMany({
      where: { campaignId, state: { notIn: ["resolved", "exhausted", "undialable"] } },
      data: { state: "exhausted" },
    });
  }

  const report = await buildCampaignReport(organizationId, campaignId);
  if (!report.reconciled) {
    throw new Error(
      "The worklists do not reconcile to the campaign totals. This is a bug — refusing to freeze until it is found.",
    );
  }

  await db.campaign.update({
    where: { id: campaignId },
    data: { engineStatus: "complete" },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "engine.campaign_completed",
    entityType: "campaign",
    entityId: campaignId,
    detail: {
      accounts: report.accounts,
      bookValue: report.bookValue,
      calls: report.calls,
      ptpCount: report.ptpCount,
      cashCommitted: report.cashCommitted,
    },
  });

  return report;
}

export type WorklistRow = {
  list: WorklistKey;
  fullName: string;
  greetingName: string;
  phone: string;
  unitNumber: string;
  buildingName: string;
  tenantCode: string;
  totalDue: number;
  attempts: number;
  outcome: string;
  note: string;
};

/** Every account, on exactly one sheet, phones as text with the +27. */
export async function buildWorklists(
  organizationId: string,
  campaignId: string,
): Promise<Record<WorklistKey, WorklistRow[]>> {
  const accounts = await db.engineAccount.findMany({
    where: { campaignId, organizationId },
    orderBy: { totalDue: "desc" },
  });
  const out = Object.fromEntries(WORKLISTS.map((l) => [l.key, [] as WorklistRow[]])) as unknown as Record<WorklistKey, WorklistRow[]>;
  for (const account of accounts) {
    out[worklistFor(account)].push({
      list: worklistFor(account),
      fullName: account.fullName,
      greetingName: account.greetingName,
      phone: account.phone ?? "",
      unitNumber: account.unitNumber ?? "",
      buildingName: account.buildingName ?? "",
      tenantCode: account.tenantCode ?? "",
      totalDue: account.totalDue,
      attempts: account.attempts,
      outcome: account.outcome ?? "",
      note: account.reviewReason ?? "",
    });
  }
  return out;
}
