import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { classifyBatch, markDeadNumbers } from "./classify";
import { RESOLVED_OUTCOMES } from "./rounds";

// ---------------------------------------------------------------------------
// "Pull the results now."
//
// The engine already classifies while a run is live, and again as a round
// closes. This is the same work on demand: the operator comes back an hour
// later, presses one button, and gets the current truth — who answered, who
// let it ring, whose number is dead — plus the count the next round would
// dial. Nothing here dials anything.
//
// Safe to press at any time, twice, or mid-run: every write underneath is
// keyed on the conversation uuid and on (account, round), so a second pass
// over the same calls records nothing new.
// ---------------------------------------------------------------------------

export type ResyncResult = {
  round: number;
  batchesSynced: number;
  /** Attempts that this pass discovered for the first time. */
  newAttempts: number;
  attempts: number;
  answered: number;
  noAnswer: number;
  voicemail: number;
  zeroDuration: number;
  resolved: number;
  /** Dialled, nobody spoke, still under the attempt cap — the redial pool. */
  redialable: number;
  /** Dialled and nothing came back at all: not even a zero-second record. */
  noResult: number;
  redialArrears: number;
  /** Numbers proved dead on this pass, so the next round does not waste a dial. */
  deadNumbers: number;
  /** Runs still uploading, so these figures are a snapshot of a live round. */
  stillCalling: number;
};

export async function resyncRound(
  organizationId: string,
  campaignId: string,
  userId: string,
): Promise<ResyncResult> {
  const campaign = await db.campaign.findFirstOrThrow({
    where: { id: campaignId, organizationId },
  });
  if (campaign.currentRound === 0) {
    throw new Error("Nothing has been dialled yet — cut a run first.");
  }

  const round = campaign.currentRound;
  const batches = await db.engineBatch.findMany({
    where: { campaignId, round, startedAt: { not: null } },
    orderBy: { index: "asc" },
  });

  const before = await db.engineAttempt.count({ where: { campaignId, round, voided: false } });

  // One batch at a time. Each call re-reads from the platform and writes what
  // is new; a batch that fails to read leaves the others' results intact.
  let synced = 0;
  for (const batch of batches) {
    try {
      await classifyBatch(organizationId, batch.id);
      synced += 1;
    } catch {
      // Reported through the totals below rather than as a failure: the pass
      // is still worth the results it did get.
    }
  }

  const deadNumbers = await markDeadNumbers(organizationId, campaignId);

  const attemptRows = await db.engineAttempt.findMany({
    where: { campaignId, round, voided: false },
    select: { accountId: true, reach: true },
  });
  const accounts = await db.engineAccount.findMany({ where: { campaignId, organizationId } });
  const accountById = new Map(accounts.map((a) => [a.id, a]));

  const spokeTo = new Set(
    attemptRows.filter((a) => a.reach === "SPOKE").map((a) => a.accountId),
  );
  const heardFrom = new Set(attemptRows.map((a) => a.accountId));

  // The pool is built from who was DIALLED, not from who came back. An account
  // whose phone simply never connected produces no call record at all — and
  // that account is the whole reason this button exists, so counting only the
  // rows the platform returned would hide exactly the people to ring again.
  const dialled = new Set<string>();
  for (const batch of batches) {
    for (const id of JSON.parse(batch.accountIds) as string[]) dialled.add(id);
  }

  let resolved = 0;
  let redialable = 0;
  let redialArrears = 0;
  let noResult = 0;
  for (const accountId of dialled) {
    const account = accountById.get(accountId);
    if (!account) continue;
    if (!heardFrom.has(accountId)) noResult += 1;
    if (account.outcome && (RESOLVED_OUTCOMES as readonly string[]).includes(account.outcome)) {
      resolved += 1;
      continue;
    }
    // The same rules the next round will apply: nobody spoke, there is a
    // number to ring, and the attempt cap is not reached.
    if (
      !spokeTo.has(accountId) &&
      account.phone &&
      account.state !== "undialable" &&
      account.attempts < campaign.maxRounds
    ) {
      redialable += 1;
      redialArrears += account.totalDue;
    }
  }

  const result: ResyncResult = {
    round,
    batchesSynced: synced,
    newAttempts: Math.max(0, attemptRows.length - before),
    attempts: attemptRows.length,
    answered: spokeTo.size,
    noAnswer: attemptRows.filter((a) => a.reach === "NO_ANSWER").length,
    voicemail: attemptRows.filter((a) => a.reach === "VOICEMAIL").length,
    zeroDuration: attemptRows.filter((a) => a.reach === "ZERO_DURATION").length,
    resolved,
    redialable,
    redialArrears,
    noResult,
    deadNumbers,
    stillCalling: batches.filter((b) => b.status === "calling").length,
  };

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "engine.resync",
    entityType: "campaign",
    entityId: campaignId,
    detail: { round, newAttempts: result.newAttempts, redialable },
  });

  return result;
}
