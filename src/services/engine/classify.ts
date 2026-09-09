import { db } from "@/lib/db";
import { runIngestion } from "@/services/jobix/ingest";

// ---------------------------------------------------------------------------
// Who actually answered.
//
// Reach is read off the transcript, never off the platform's own fields — the
// platform's outcome column has been materially wrong on every campaign
// measured, including a round where it recorded blanks for all eleven live
// conversations. The transcript is what happened; everything else is a claim
// about it.
//
// Ingest is a reuse of the pipeline analytics already trusts (page size 50,
// UTC timestamps, restart-on-401, transcripts in bounded batches, workspace
// gate); this file only matches its output to engine accounts and rolls it up.
// ---------------------------------------------------------------------------

export const VOICEMAIL_PATTERN =
  /(voicemail|leave a message|after the tone|not available|unavailable|please leave|voice mail|mailbox|subscriber|switched off|does not exist|try again later|answering machine|record your message|cannot be reached|no longer in service)/i;

export type Reach = "SPOKE" | "VOICEMAIL" | "NO_ANSWER" | "ZERO_DURATION";

/** §4.3 verbatim. Below 15 tenant words a call is a greeting, not a discussion. */
export function reach(attempt: {
  durationSeconds: number;
  userTurns: number;
  userWords: number;
  excerpt: string;
}): Reach {
  if (attempt.durationSeconds === 0) return "ZERO_DURATION";
  if (attempt.userTurns === 0) return "NO_ANSWER";
  if (VOICEMAIL_PATTERN.test(attempt.excerpt) && attempt.userWords < 15) return "VOICEMAIL";
  return "SPOKE";
}

export const SUBSTANTIVE_WORDS = 15;

/**
 * Outcomes the transcript itself can state. Only these words are believed;
 * anything else stays NO_OUTCOME for a human to read. Order matters — the
 * first match wins, and the firm commitments are checked before the excuses.
 */
const OUTCOME_PATTERNS: [RegExp, string][] = [
  [/\b(dispute|not my (debt|account)|already cancelled|incorrect(ly)? billed)\b/i, "DISPUTE"],
  [/\b(already paid|paid (it|this|that) (already|last)|proof of payment|settled (it|the account))\b/i, "PAID"],
  [/\b(wrong (number|person)|don'?t know (that|this) person|no [A-Z][a-z]+ here)\b/i, "WRONG"],
  [/\b(will pay|going to pay|promise to pay|make (a|the) payment|pay (it|you|the full)|eft|debit order)\b.{0,80}\b(today|tomorrow|friday|monday|month end|end of the month|payday|\d{1,2}(st|nd|rd|th)?)\b/i, "PTP"],
  [/\b(pay (half|part|a portion|some)|partial payment|instal?lments?|arrangement)\b/i, "PART"],
  [/\b(call (me )?back|phone (me )?(back|later)|busy right now|in a meeting|driving)\b/i, "CALLBACK"],
  [/\b(come (in|to) the office|visit the office|speak to the office|at reception)\b/i, "OFFICE"],
  [/\b(refuse|won'?t pay|not paying|stop calling|harass)\b/i, "REFUSED"],
  [/\b(lawyer|attorney|legal|ombud|escalate)\b/i, "ESCALATED"],
];

export function statedEngineOutcome(userText: string): string | null {
  for (const [pattern, outcome] of OUTCOME_PATTERNS) {
    if (pattern.test(userText)) return outcome;
  }
  return null;
}

export type BatchGuardStats = {
  attempts: number;
  zeroRate: number;
  newestAttemptAt: Date | null;
};

/**
 * Pull what has happened for one batch and write it down.
 *
 * Matching: a conversation belongs to this batch when its phone is one of the
 * batch's accounts and it started after the batch did (minus a minute of clock
 * slack). Weaker than an id join — which is why an account is only matched to
 * ONE conversation per ingest pass (the earliest unclaimed), and why every
 * insert is keyed on the conversation uuid so nothing is ever counted twice.
 */
export async function classifyBatch(organizationId: string, batchId: string): Promise<BatchGuardStats> {
  const batch = await db.engineBatch.findFirstOrThrow({ where: { id: batchId, organizationId } });
  const accountIds = JSON.parse(batch.accountIds) as string[];
  const accounts = await db.engineAccount.findMany({ where: { id: { in: accountIds } } });
  const byPhone = new Map(accounts.filter((a) => a.phone).map((a) => [a.phone as string, a]));
  const since = batch.startedAt ? new Date(batch.startedAt.getTime() - 60_000) : new Date();

  // A short, budgeted ingest — the tick runs inside a request. Failures here
  // must not kill the tick: the next tick ingests again.
  try {
    await runIngestion({
      organizationId,
      since,
      budgetMs: 45_000,
      expectedAgentNames: [process.env.JOBIX_EXPECTED_AGENT || "Siya"],
    });
  } catch {
    // The read failed; classification below still runs over what is cached.
  }

  const conversations = await db.jobixConversation.findMany({
    where: {
      organizationId,
      startedAt: { gte: since },
      phone: { in: [...byPhone.keys()] },
    },
    include: { transcript: true },
    orderBy: { startedAt: "asc" },
  });

  for (const conversation of conversations) {
    const account = byPhone.get(conversation.phone);
    if (!account) continue;

    // Lock 1: keyed on the conversation uuid. A retried tick, a re-ingest, a
    // webhook race — none of them can count this call twice.
    const existing = await db.engineAttempt.findFirst({
      where: { organizationId, conversationUuid: conversation.uuid },
    });
    if (existing) continue;

    // Lock 2: one live attempt per account per round. A second conversation on
    // the same number inside one round (a manual redial, an inbound return
    // call) is real but is not THIS round's attempt slot; the partial unique
    // index would refuse it anyway — skipping keeps the error out of the tick.
    const held = await db.engineAttempt.findFirst({
      where: { accountId: account.id, round: batch.round, voided: false },
    });
    if (held) continue;

    const t = conversation.transcript;
    const excerpt = (t?.userText ?? "").slice(0, 600);
    const verdict = reach({
      durationSeconds: conversation.durationSeconds,
      userTurns: t?.userTurns ?? 0,
      userWords: t?.userWords ?? 0,
      excerpt,
    });
    const substantive = (t?.userWords ?? 0) >= SUBSTANTIVE_WORDS;

    await db.engineAttempt.create({
      data: {
        organizationId,
        campaignId: batch.campaignId,
        accountId: account.id,
        batchId: batch.id,
        round: batch.round,
        conversationUuid: conversation.uuid,
        startedAt: conversation.startedAt,
        durationSeconds: conversation.durationSeconds,
        userTurns: t?.userTurns ?? 0,
        userWords: t?.userWords ?? 0,
        excerpt,
        reach: verdict,
        substantive,
      },
    });

    // --- account rollup --------------------------------------------------
    const outcome = substantive ? statedEngineOutcome(t?.userText ?? "") : null;
    const uncaptured = substantive && !outcome;
    await db.engineAccount.update({
      where: { id: account.id },
      data: {
        attempts: { increment: batch.countsAttempt ? 1 : 0 },
        lastAttemptAt: conversation.startedAt,
        ...(verdict === "SPOKE" ? { state: "reached" } : {}),
        ...(outcome ? { outcome, state: "resolved" } : {}),
        // A real conversation with nothing captured is a worklist item, not a
        // silent NO_OUTCOME.
        ...(uncaptured
          ? { needsReview: true, reviewReason: "conversation not captured — transcript exists, no outcome recorded" }
          : {}),
        ...(verdict === "SPOKE" && !outcome ? { outcome: "NO_OUTCOME" } : {}),
      },
    });
  }

  // --- the numbers the guards read -----------------------------------------
  const attempts = await db.engineAttempt.findMany({
    where: { batchId: batch.id, voided: false },
    select: { durationSeconds: true, classifiedAt: true, startedAt: true },
  });
  const zero = attempts.filter((a) => a.durationSeconds === 0).length;
  return {
    attempts: attempts.length,
    zeroRate: attempts.length > 0 ? zero / attempts.length : 0,
    newestAttemptAt:
      attempts.length > 0
        ? new Date(Math.max(...attempts.map((a) => a.classifiedAt.getTime())))
        : null,
  };
}

/**
 * §4.5 — the per-account dead-number rule, run when a campaign is reviewed:
 * dead only if EVERY non-voided attempt across ALL rounds was zero seconds AND
 * that phone has never produced a SPOKE attempt in ANY campaign. A number that
 * has ever spoken is never marked dead on zero-duration alone.
 */
export async function markDeadNumbers(organizationId: string, campaignId: string): Promise<number> {
  const accounts = await db.engineAccount.findMany({
    where: { campaignId, state: { notIn: ["resolved", "undialable"] }, phone: { not: null } },
    include: { attemptsLog: { where: { voided: false } } },
  });

  let marked = 0;
  for (const account of accounts) {
    if (account.attemptsLog.length === 0) continue;
    const allZero = account.attemptsLog.every((a) => a.durationSeconds === 0);
    if (!allZero) continue;

    const everSpoke = await db.engineAttempt.findFirst({
      where: {
        organizationId,
        reach: "SPOKE",
        account: { phone: account.phone },
      },
    });
    // Cross-check the wider call history too — a conversation the engine never
    // claimed still proves the number is alive.
    const everConversed = everSpoke
      ? true
      : (await db.jobixTranscript.findFirst({
          where: {
            organizationId,
            userTurns: { gt: 0 },
            conversation: { phone: account.phone! },
          },
        })) !== null;

    if (everSpoke || everConversed) continue;
    await db.engineAccount.update({
      where: { id: account.id },
      data: { state: "undialable", reviewReason: "dead number — every attempt 0s, never a conversation on this phone" },
    });
    marked += 1;
  }
  return marked;
}
