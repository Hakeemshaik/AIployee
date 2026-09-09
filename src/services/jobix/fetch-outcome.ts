import { db } from "@/lib/db";
import { JobixClient, JobixError, resolveJobixEnv } from "./client";
import { fetchTranscript, pullConversations } from "./api";
import { recordDialOutcome } from "@/services/integrations/dial-outcome";

// ---------------------------------------------------------------------------
// Go and get the result, rather than waiting to be told.
//
// The outcome webhook is the better mechanism — the platform knows the moment a
// call ends, and pushing costs nothing. But it has to be configured on the
// flow, and until it is, a dial sits at "ringing" for ever while the
// conversation, the transcript and the outcome are all sitting on the platform
// waiting to be read.
//
// So: read them. The conversation list filters by phone number, which is the
// join available here — the dial knows the number it rang and the minute it
// rang it, and a conversation on that number after that minute is this call.
// It is a weaker join than the suid the webhook carries (two calls to the same
// number a minute apart would be ambiguous), so it only ever looks at
// conversations that started after the dial was placed and takes the earliest
// one, and it never overwrites a result the webhook already recorded.
// ---------------------------------------------------------------------------

export type FetchOutcomeResult =
  | { found: false; reason: string; scanned: number }
  | { found: true; state: string; conversationUuid: string };

/** A minute of slack: the platform's clock and ours are not the same clock. */
const CLOCK_SLACK_MS = 60_000;

/**
 * A conversation is a call that happened; whether anybody was on it is a
 * different question. A few seconds with one turn is a phone ringing into
 * nothing, and counting that as "reached" is how a reach rate becomes fiction.
 */
function reached(durationSeconds: number, turns: number): boolean {
  return durationSeconds >= 8 && turns >= 2;
}

export async function fetchDialOutcome(
  organizationId: string,
  attemptId: string,
): Promise<FetchOutcomeResult> {
  const attempt = await db.dialAttempt.findFirst({ where: { organizationId, id: attemptId } });
  if (!attempt) throw new JobixError("No such dial.", "rejected");
  if (attempt.state !== "placed") {
    return { found: true, state: attempt.state, conversationUuid: attempt.callId ?? "" };
  }

  const env = await resolveJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");
  const client = new JobixClient(env);

  const since = new Date(attempt.requestedAt.getTime() - CLOCK_SLACK_MS);
  const { conversations } = await pullConversations(client, {
    filters: { phone: attempt.phone },
    since,
    // Two pages of one number's calls is plenty; this runs inside a request.
    maxPages: 2,
  });

  // Oldest first among those that started after the dial: the first call on
  // that number after the write is the one the write caused.
  const candidates = conversations
    .filter((conversation) => conversation.createdAt >= since)
    .sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());

  const conversation = candidates[0];
  if (!conversation) {
    return {
      found: false,
      reason:
        "The platform has no conversation on this number since the dial was placed. Either the call has not run yet, or the flow did not act on the record.",
      scanned: conversations.length,
    };
  }

  let turns: { role: string; text: string }[] = [];
  try {
    const transcript = await fetchTranscript(client, conversation.uuid);
    turns = transcript.turns;
  } catch {
    // A conversation with no readable transcript is still a call that
    // happened. Recording it without the words beats recording nothing.
  }

  const answered = reached(conversation.durationSeconds, turns.length);
  await recordDialOutcome(organizationId, `pull:${attemptId}`, {
    suid: attempt.suid,
    status: answered ? "answered" : "no_answer",
    event_id: conversation.uuid,
    started_at: conversation.createdAt,
    ended_at: new Date(conversation.createdAt.getTime() + conversation.durationSeconds * 1000),
    duration_seconds: conversation.durationSeconds,
    to_number: conversation.phone,
    agent: conversation.agentUuid ?? undefined,
    transcript: turns.map((turn) => ({ role: turn.role, text: turn.text })),
  });

  return {
    found: true,
    state: answered ? "reached" : "no_answer",
    conversationUuid: conversation.uuid,
  };
}
