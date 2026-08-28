import { db } from "@/lib/db";
import {
  classifyCampaign,
  type ClassifiableAccount,
  type ClassifiedResult,
} from "./classify";

// ---------------------------------------------------------------------------
// Analytics over ingested Jobix data.
//
// Accounts come from the debtor book; calls and transcripts come from the local
// Jobix cache. Classification then runs through exactly the same engine the
// demo uses.
//
// Two things this file has to be careful about:
//
//   * WHICH CALLS BELONG TO AN ACCOUNT. A call is claimed by identifier first —
//     the provider's customer uuid, stored on both sides at ingestion — and
//     only what is left over is matched on phone number. Doing it in that
//     order means a number shared by two records cannot hand the same call to
//     both, and it honours the rule that a phone number is not a relationship.
//   * WHAT IT READS. This runs on every page load, so it selects the columns
//     it needs and nothing else. Selecting the whole transcript row pulled the
//     full turn-by-turn JSON — up to 200 KB a call — for every call in the
//     book, which is why the screen took as long as it did.
// ---------------------------------------------------------------------------

export type LiveAnalyticsRow = {
  accountId: string;
  name: string;
  phone: string;
  accountNumber: string;
  building: string | null;
  balance: number;
  outcome: NonNullable<ClassifiableAccount["outcome"]>;
};

function normalise(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-9);
}

/**
 * Assign each call to exactly one account: provider identifier first, phone
 * number for whatever is left over.
 *
 * Exported because the dashboard has to answer "how many were contacted" with
 * the same rule the analytics screen uses. Two definitions of contact in one
 * product is how a dashboard ends up reading zero while the analytics read a
 * thousand.
 */
export function claimCalls<
  D extends { id: string; phone: string; providerContactUuid: string | null },
  C extends { phone: string; contactUuid: string | null },
>(debtors: D[], conversations: C[]): Map<string, C[]> {
  const debtorByUuid = new Map<string, string>();
  const debtorByPhone = new Map<string, string>();
  for (const debtor of debtors) {
    if (debtor.providerContactUuid) debtorByUuid.set(debtor.providerContactUuid, debtor.id);
    const key = normalise(debtor.phone);
    // First writer wins, so a duplicated number resolves the same way twice.
    if (key && !debtorByPhone.has(key)) debtorByPhone.set(key, debtor.id);
  }

  const claimed = new Map<string, C[]>();
  const claim = (debtorId: string, call: C) => {
    const list = claimed.get(debtorId) ?? [];
    list.push(call);
    claimed.set(debtorId, list);
  };

  const unclaimed: C[] = [];
  for (const conversation of conversations) {
    const byIdentifier = conversation.contactUuid ? debtorByUuid.get(conversation.contactUuid) : undefined;
    if (byIdentifier) claim(byIdentifier, conversation);
    else unclaimed.push(conversation);
  }
  for (const conversation of unclaimed) {
    const debtorId = debtorByPhone.get(normalise(conversation.phone));
    if (debtorId) claim(debtorId, conversation);
  }
  return claimed;
}

export async function buildLiveAnalytics(
  organizationId: string,
  options: { campaignId?: string } = {},
): Promise<{
  result: ClassifiedResult;
  rows: LiveAnalyticsRow[];
  transcriptCoverage: number;
  callsTotal: number;
  callsWithTranscript: number;
}> {
  const debtors = await db.debtor.findMany({
    where: { organizationId, ...(options.campaignId ? { campaignId: options.campaignId } : {}) },
    select: {
      id: true,
      firstName: true,
      lastName: true,
      phone: true,
      accountNumber: true,
      status: true,
      doNotContact: true,
      wrongPerson: true,
      providerContactUuid: true,
      accounts: { select: { currentBalance: true, creditorName: true } },
      promises: { select: { amount: true, status: true }, orderBy: { createdAt: "desc" } },
    },
  });

  const conversations = await db.jobixConversation.findMany({
    where: { organizationId },
    // Deliberately not `include: { transcript: true }` — that carries the full
    // turn-by-turn JSON, which nothing here reads.
    select: {
      uuid: true,
      phone: true,
      contactUuid: true,
      durationSeconds: true,
      startedAt: true,
      transcript: { select: { userTurns: true, userWords: true, userText: true } },
    },
    orderBy: { startedAt: "asc" },
  });

  const callsByDebtor = claimCalls(debtors, conversations);

  const rows: LiveAnalyticsRow[] = [];
  const accounts: ClassifiableAccount[] = [];
  let withTranscript = 0;
  let totalCalls = 0;

  for (const debtor of debtors) {
    const balance = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    // A cancelled promise was withdrawn, so it is not a commitment. Broken and
    // fulfilled ones were real commitments and still count as a PTP.
    const commitments = debtor.promises.filter((p) => p.status !== "cancelled");
    const openPromise = commitments.find((p) => p.status === "pending");
    const outcome = {
      ptpConfirmed: commitments.length > 0,
      ptpAmount: openPromise?.amount ?? commitments[0]?.amount ?? null,
      disputed: debtor.status === "dispute",
      paidClaimed: debtor.status === "paid",
      escalated: debtor.status === "escalated",
      doNotCall: debtor.doNotContact,
      wrongPerson: debtor.wrongPerson,
    };

    const matched = callsByDebtor.get(debtor.id) ?? [];
    totalCalls += matched.length;

    accounts.push({
      accountId: debtor.id,
      phone: debtor.phone,
      balance,
      outcome,
      calls: matched.map((conversation) => {
        if (conversation.transcript) withTranscript += 1;
        return {
          conversationUuid: conversation.uuid,
          durationSeconds: conversation.durationSeconds,
          startedAt: conversation.startedAt,
          transcript: conversation.transcript
            ? {
                conversationUuid: conversation.uuid,
                userTurns: conversation.transcript.userTurns,
                userText: conversation.transcript.userText,
                userWords: conversation.transcript.userWords,
              }
            : null,
        };
      }),
    });

    rows.push({
      accountId: debtor.id,
      name: `${debtor.firstName} ${debtor.lastName}`,
      phone: debtor.phone,
      accountNumber: debtor.accountNumber,
      building: debtor.accounts[0]?.creditorName ?? null,
      balance,
      outcome,
    });
  }

  return {
    result: classifyCampaign(accounts),
    rows,
    transcriptCoverage: totalCalls > 0 ? withTranscript / totalCalls : 0,
    // Counts as well as the ratio: a call with no transcript counts as not
    // reached, so the screen has to be able to say how many that is.
    callsTotal: totalCalls,
    callsWithTranscript: withTranscript,
  };
}
