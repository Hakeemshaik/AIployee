import { db } from "@/lib/db";
import { reachVerdict } from "@/services/analytics/classify";

// ---------------------------------------------------------------------------
// The calls that ran for one campaign.
//
// Jobix's conversation records do not carry a campaign id — nothing on the
// provider side knows what a campaign is. Two things do tie a call back here,
// in descending order of trust, and which one was used travels with every row
// so a weaker join is never presented as a strong one:
//
//   1. contact uuid — the provider's own customer identifier, stored on the
//      debtor at ingestion. A real identifier join.
//   2. phone number — the fallback when a conversation record has no contact
//      uuid. The last nine digits, which is the stable core of a South
//      African number in any format.
//
// The batch code is the campaign's dialling marker. The generated list writes
// it to the `batch` column, which exists only to say which run a customer came
// from; the separate `call` column carries the fixed flag the flow's entry
// filter matches on, so starting a run never means editing the flow. Calls
// that predate the batch being sent belong to an earlier run, so they are
// excluded and counted rather than folded in to flatter the numbers.
// ---------------------------------------------------------------------------

export type CampaignCallMatch = "contact_uuid" | "phone";

export const MATCH_NOTES: Record<CampaignCallMatch, string> = {
  contact_uuid: "Matched on the voice platform's own customer identifier.",
  phone: "Matched on phone number — this call record carried no customer identifier.",
};

export type CampaignCall = {
  conversationUuid: string;
  debtorId: string;
  name: string;
  phone: string;
  accountNumber: string;
  startedAt: Date;
  durationSeconds: number;
  agentName: string | null;
  flowName: string | null;
  attempt: number;
  reached: boolean;
  reason: string;
  matchedBy: CampaignCallMatch;
};

export type CampaignCallLog = {
  batchCode: string | null;
  batchSentAt: Date | null;
  accountsInCampaign: number;
  /** Accounts carrying this campaign's batch code on the provider record. */
  accountsCarryingBatch: number;
  accountsDialled: number;
  totalCalls: number;
  reachedCalls: number;
  /** Calls to these accounts from before the batch was sent — excluded. */
  callsBeforeBatch: number;
  calls: CampaignCall[];
  truncated: number;
};

/** Last 9 digits — the stable core of a South African number in any format. */
function phoneKey(phone: string): string | null {
  const digits = phone.replace(/[^\d]/g, "");
  return digits.length >= 9 ? digits.slice(-9) : null;
}

const CALL_CAP = 500;

export async function campaignCallLog(
  organizationId: string,
  campaignId: string,
): Promise<CampaignCallLog | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, providerCampaignId: true, providerStartedAt: true },
  });
  if (!campaign) return null;

  const debtors = await db.debtor.findMany({
    where: { organizationId, campaignId: campaign.id },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      accountNumber: true,
      providerContactUuid: true,
      callBatch: true,
    },
  });

  const byUuid = new Map<string, (typeof debtors)[number]>();
  const byPhone = new Map<string, (typeof debtors)[number]>();
  for (const debtor of debtors) {
    if (debtor.providerContactUuid) byUuid.set(debtor.providerContactUuid, debtor);
    const key = phoneKey(debtor.phone);
    if (key) byPhone.set(key, debtor);
  }

  const accountsCarryingBatch = campaign.providerCampaignId
    ? debtors.filter((d) => d.callBatch === campaign.providerCampaignId).length
    : 0;

  const empty: CampaignCallLog = {
    batchCode: campaign.providerCampaignId,
    batchSentAt: campaign.providerStartedAt,
    accountsInCampaign: debtors.length,
    accountsCarryingBatch,
    accountsDialled: 0,
    totalCalls: 0,
    reachedCalls: 0,
    callsBeforeBatch: 0,
    calls: [],
    truncated: 0,
  };
  if (debtors.length === 0) return empty;

  // Conversations are read for the organization and matched in memory: the
  // identifier join is on a provider uuid and the fallback is a phone suffix,
  // neither of which a WHERE clause can express usefully.
  const conversations = await db.jobixConversation.findMany({
    where: { organizationId },
    select: {
      uuid: true,
      contactUuid: true,
      phone: true,
      startedAt: true,
      durationSeconds: true,
      agentName: true,
      flowName: true,
      transcript: { select: { conversationUuid: true, userTurns: true, userWords: true, userText: true } },
    },
    orderBy: { startedAt: "desc" },
  });

  const matched: CampaignCall[] = [];
  let callsBeforeBatch = 0;
  const attemptsByDebtor = new Map<string, number>();
  const dialled = new Set<string>();

  // Oldest first, so an attempt number counts up the way the calls happened.
  for (const conversation of [...conversations].reverse()) {
    let debtor = conversation.contactUuid ? byUuid.get(conversation.contactUuid) : undefined;
    let matchedBy: CampaignCallMatch = "contact_uuid";
    if (!debtor) {
      const key = phoneKey(conversation.phone);
      debtor = key ? byPhone.get(key) : undefined;
      matchedBy = "phone";
    }
    if (!debtor) continue;

    if (campaign.providerStartedAt && conversation.startedAt < campaign.providerStartedAt) {
      callsBeforeBatch += 1;
      continue;
    }

    const attempt = (attemptsByDebtor.get(debtor.id) ?? 0) + 1;
    attemptsByDebtor.set(debtor.id, attempt);
    dialled.add(debtor.id);

    const verdict = reachVerdict({
      durationSeconds: conversation.durationSeconds,
      transcript: conversation.transcript,
    });

    matched.push({
      conversationUuid: conversation.uuid,
      debtorId: debtor.id,
      name: `${debtor.firstName} ${debtor.lastName}`.trim(),
      phone: debtor.phone,
      accountNumber: debtor.accountNumber,
      startedAt: conversation.startedAt,
      durationSeconds: conversation.durationSeconds,
      agentName: conversation.agentName,
      flowName: conversation.flowName,
      attempt,
      reached: verdict.reached,
      reason: verdict.reason,
      matchedBy,
    });
  }

  // Newest first for display; the attempt numbers were assigned chronologically.
  matched.reverse();

  return {
    ...empty,
    accountsDialled: dialled.size,
    totalCalls: matched.length,
    reachedCalls: matched.filter((call) => call.reached).length,
    callsBeforeBatch,
    calls: matched.slice(0, CALL_CAP),
    truncated: Math.max(0, matched.length - CALL_CAP),
  };
}
