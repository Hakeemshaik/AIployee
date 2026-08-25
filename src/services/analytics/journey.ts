import { db } from "@/lib/db";
import fixture from "@/fixtures/demo-campaign.json";
import {
  classifyAccount,
  reachVerdict,
  summariseTranscript,
  type AccountBucket,
  type ClassifiableCall,
} from "./classify";
import {
  CHANNEL_LABELS,
  MATCH_BASIS_NOTES,
  matchMessagingEvents,
  messagingChannel,
  nameKey,
  type MessagingChannel,
  type MessagingMatchBasis,
} from "@/services/jobix/messaging";

// ---------------------------------------------------------------------------
// One account's full history, for the drawer on the analytics screen.
//
// The table answers "who should we call"; this answers "why does the platform
// think that". So every call carries its own reach verdict and the reasoning
// behind it, and the platform's voicemail flag is shown beside the verdict
// rather than used to produce it — seeing the two disagree is the point.
//
// Messaging steps are matched on customer name because that is the only key
// Jobix puts on a node-history row. The match basis travels with the data so
// the UI can say so instead of implying an account-level join.
// ---------------------------------------------------------------------------

export type JourneyCall = {
  conversationUuid: string;
  attempt: number;
  startedAt: Date;
  durationSeconds: number;
  agentName: string | null;
  flowName: string | null;
  /** The provider's own voicemail flag — displayed, never used to decide reach. */
  voicemailFlag: boolean;
  reached: boolean;
  reason: string;
  transcriptAvailable: boolean;
  tenantWords: number;
  turns: { role: string; text: string }[];
};

export type JourneyMessagingEvent = {
  channel: MessagingChannel;
  channelLabel: string;
  nodeName: string | null;
  succeeded: boolean;
  failed: boolean;
  matchedFilter: boolean | null;
  occurredAt: Date;
};

export type AccountJourney = {
  accountId: string;
  name: string;
  phone: string;
  unit: string | null;
  building: string | null;
  balance: number;
  bucket: AccountBucket;
  attempts: number;
  firstReachAttempt: number | null;
  tenantWords: number;
  flags: {
    hasPtp: boolean;
    ptpAmount: number | null;
    disputed: boolean;
    paidClaimed: boolean;
    escalated: boolean;
    doNotCall: boolean;
  };
  calls: JourneyCall[];
  messaging: {
    basis: MessagingMatchBasis;
    note: string;
    events: JourneyMessagingEvent[];
  };
};

type FixtureShape = {
  accounts: {
    accountId: string;
    name: string;
    phone: string;
    unit: string | null;
    building: string;
    balance: number;
    calls: { uuid: string; startedAt: string; durationSeconds: number }[];
    outcome: {
      ptpConfirmed: boolean;
      ptpAmount: number | null;
      disputed: boolean;
      paidClaimed: boolean;
      escalated: boolean;
      doNotCall: boolean;
    };
  }[];
  conversations: { uuid: string; agentName: string; flowName: string; voicemailFlag: boolean }[];
  transcripts: Record<string, { role: string; text: string }[]>;
  nodeEvents: {
    companyNodeId: number;
    nodeName: string;
    status: number;
    outputSocketId: string | null;
    customerName: string;
    createdAt: string;
  }[];
};

const data = fixture as unknown as FixtureShape;

/**
 * Build the per-call view: attempts numbered by time, each with its verdict.
 *
 * Numbering follows the sorted order, so "attempt 3" means the third call
 * actually made — not the third row the provider happened to return.
 */
function buildCalls(
  calls: (ClassifiableCall & {
    agentName: string | null;
    flowName: string | null;
    voicemailFlag: boolean;
    turns: { role: string; text: string }[];
  })[],
): JourneyCall[] {
  return [...calls]
    .sort((a, b) => a.startedAt.getTime() - b.startedAt.getTime())
    .map((call, index) => {
      const verdict = reachVerdict(call);
      return {
        conversationUuid: call.conversationUuid,
        attempt: index + 1,
        startedAt: call.startedAt,
        durationSeconds: call.durationSeconds,
        agentName: call.agentName,
        flowName: call.flowName,
        voicemailFlag: call.voicemailFlag,
        reached: verdict.reached,
        reason: verdict.reason,
        transcriptAvailable: !!call.transcript,
        tenantWords: call.transcript?.userWords ?? 0,
        turns: call.turns,
      };
    });
}

export function buildDemoJourney(accountId: string): AccountJourney | null {
  const account = data.accounts.find((a) => a.accountId === accountId);
  if (!account) return null;

  const meta = new Map(data.conversations.map((c) => [c.uuid, c]));
  const enriched = account.calls.map((call) => {
    const turns = data.transcripts[call.uuid] ?? [];
    const conversation = meta.get(call.uuid);
    return {
      conversationUuid: call.uuid,
      durationSeconds: call.durationSeconds,
      startedAt: new Date(call.startedAt),
      transcript: turns.length > 0 ? summariseTranscript(call.uuid, turns) : null,
      agentName: conversation?.agentName ?? null,
      flowName: conversation?.flowName ?? null,
      voicemailFlag: conversation?.voicemailFlag ?? false,
      turns,
    };
  });

  const classified = classifyAccount({
    accountId: account.accountId,
    phone: account.phone,
    balance: account.balance,
    outcome: account.outcome,
    calls: enriched,
  });

  const events = data.nodeEvents.map((e) => ({
    customerKey: nameKey(e.customerName),
    channel: messagingChannel(e.nodeName),
    nodeName: e.nodeName,
    status: e.status,
    outputSocketId: e.outputSocketId,
    occurredAt: new Date(e.createdAt),
  }));
  const { events: matched, basis } = matchMessagingEvents(
    account.name,
    events,
    data.accounts.map((a) => a.name),
  );

  return {
    accountId: account.accountId,
    name: account.name,
    phone: account.phone,
    unit: account.unit,
    building: account.building,
    balance: account.balance,
    bucket: classified.bucket,
    attempts: classified.attempts,
    firstReachAttempt: classified.firstReachAttempt,
    tenantWords: classified.tenantWords,
    flags: {
      hasPtp: account.outcome.ptpConfirmed,
      ptpAmount: account.outcome.ptpAmount,
      disputed: account.outcome.disputed,
      paidClaimed: account.outcome.paidClaimed,
      escalated: account.outcome.escalated,
      doNotCall: account.outcome.doNotCall,
    },
    calls: buildCalls(enriched),
    messaging: {
      basis,
      note: MATCH_BASIS_NOTES[basis],
      events: matched
        .map((e) => ({
          channel: e.channel,
          channelLabel: CHANNEL_LABELS[e.channel],
          nodeName: e.nodeName,
          succeeded: e.status === 13,
          failed: e.status === 98,
          matchedFilter: e.outputSocketId ? e.outputSocketId.endsWith("_0") : null,
          occurredAt: e.occurredAt,
        }))
        .sort((a, b) => a.occurredAt.getTime() - b.occurredAt.getTime()),
    },
  };
}

function normalisePhone(phone: string): string {
  return phone.replace(/[^\d]/g, "").slice(-9);
}

function parseTurns(raw: string): { role: string; text: string }[] {
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed
      .map((t) => ({
        role: String((t as Record<string, unknown>).role ?? "assistant"),
        text: String(
          (t as Record<string, unknown>).text ?? (t as Record<string, unknown>).content ?? "",
        ),
      }))
      .filter((t) => t.text.length > 0);
  } catch {
    // A truncated cache entry costs the bubbles, not the verdict — the stored
    // summary counts are what classification uses.
    return [];
  }
}

export async function buildLiveJourney(
  organizationId: string,
  accountId: string,
): Promise<AccountJourney | null> {
  const debtor = await db.debtor.findFirst({
    where: { id: accountId, organizationId },
    include: {
      accounts: { select: { currentBalance: true, creditorName: true } },
      promises: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!debtor) return null;

  const name = `${debtor.firstName} ${debtor.lastName}`;
  const balance = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);

  // Calls are matched on phone, which is the strongest key Jobix exposes on a
  // conversation.
  const conversations = await db.jobixConversation.findMany({
    where: { organizationId },
    include: { transcript: true },
    orderBy: { startedAt: "asc" },
  });
  const wanted = normalisePhone(debtor.phone);
  const mine = conversations.filter((c) => normalisePhone(c.phone) === wanted);

  const enriched = mine.map((c) => ({
    conversationUuid: c.uuid,
    durationSeconds: c.durationSeconds,
    startedAt: c.startedAt,
    transcript: c.transcript
      ? {
          conversationUuid: c.uuid,
          userTurns: c.transcript.userTurns,
          userText: c.transcript.userText,
          userWords: c.transcript.userWords,
        }
      : null,
    agentName: c.agentName,
    flowName: c.flowName,
    voicemailFlag: c.voicemailFlag,
    turns: c.transcript ? parseTurns(c.transcript.turns) : [],
  }));

  const openPromise = debtor.promises.find((p) => p.status === "pending");
  const outcome = {
    ptpConfirmed: debtor.promises.length > 0,
    ptpAmount: openPromise?.amount ?? debtor.promises[0]?.amount ?? null,
    disputed: debtor.status === "dispute",
    paidClaimed: debtor.status === "paid",
    escalated: debtor.status === "escalated",
    doNotCall: debtor.doNotContact,
  };

  const classified = classifyAccount({
    accountId: debtor.id,
    phone: debtor.phone,
    balance,
    outcome,
    calls: enriched,
  });

  // Messaging steps carry only a customer name, so the ambiguity check looks at
  // every other name in the book before attributing them to this account.
  const key = nameKey(name);
  const nodeEvents = key
    ? await db.jobixNodeEvent.findMany({
        where: { organizationId, customerKey: key },
        orderBy: { occurredAt: "asc" },
      })
    : [];
  const sameName = key
    ? await db.debtor.count({ where: { organizationId, firstName: debtor.firstName, lastName: debtor.lastName } })
    : 0;
  const basis: MessagingMatchBasis =
    nodeEvents.length === 0 ? "none" : sameName > 1 ? "ambiguous_name" : "name";

  return {
    accountId: debtor.id,
    name,
    phone: debtor.phone,
    unit: debtor.accountNumber,
    building: debtor.accounts[0]?.creditorName ?? null,
    balance,
    bucket: classified.bucket,
    attempts: classified.attempts,
    firstReachAttempt: classified.firstReachAttempt,
    tenantWords: classified.tenantWords,
    flags: {
      hasPtp: outcome.ptpConfirmed,
      ptpAmount: outcome.ptpAmount,
      disputed: outcome.disputed,
      paidClaimed: outcome.paidClaimed,
      escalated: outcome.escalated,
      doNotCall: outcome.doNotCall,
    },
    calls: buildCalls(enriched),
    messaging: {
      basis,
      note: MATCH_BASIS_NOTES[basis],
      events: nodeEvents.map((e) => ({
        channel: messagingChannel(e.nodeName),
        channelLabel: CHANNEL_LABELS[messagingChannel(e.nodeName)],
        nodeName: e.nodeName,
        succeeded: e.succeeded,
        failed: e.failed,
        matchedFilter: e.matchedFilter,
        occurredAt: e.occurredAt,
      })),
    },
  };
}
