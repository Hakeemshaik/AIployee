import { db } from "@/lib/db";
import {
  classifyCampaign,
  type ClassifiableAccount,
  type ClassifiedResult,
} from "./classify";

// ---------------------------------------------------------------------------
// Analytics over ingested Jobix data.
//
// Accounts come from the debtor book; calls and transcripts come from the
// local Jobix cache, matched on phone number in E.164. Classification then
// runs through exactly the same engine the demo uses.
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

export async function buildLiveAnalytics(
  organizationId: string,
  options: { campaignId?: string } = {},
): Promise<{ result: ClassifiedResult; rows: LiveAnalyticsRow[]; transcriptCoverage: number }> {
  const debtors = await db.debtor.findMany({
    where: { organizationId, ...(options.campaignId ? { campaignId: options.campaignId } : {}) },
    include: { accounts: { select: { currentBalance: true, creditorName: true } }, promises: true },
  });

  const conversations = await db.jobixConversation.findMany({
    where: { organizationId },
    include: { transcript: true },
    orderBy: { startedAt: "asc" },
  });

  const byPhone = new Map<string, typeof conversations>();
  for (const conversation of conversations) {
    const key = normalise(conversation.phone);
    const list = byPhone.get(key) ?? [];
    list.push(conversation);
    byPhone.set(key, list);
  }

  const rows: LiveAnalyticsRow[] = [];
  const accounts: ClassifiableAccount[] = [];
  let withTranscript = 0;
  let totalCalls = 0;

  for (const debtor of debtors) {
    const balance = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    const openPromise = debtor.promises.find((p) => p.status === "pending");
    const outcome = {
      ptpConfirmed: debtor.promises.length > 0,
      ptpAmount: openPromise?.amount ?? debtor.promises[0]?.amount ?? null,
      disputed: debtor.status === "dispute",
      paidClaimed: debtor.status === "paid",
      escalated: debtor.status === "escalated",
      doNotCall: debtor.doNotContact,
    };

    const matched = byPhone.get(normalise(debtor.phone)) ?? [];
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
  };
}
