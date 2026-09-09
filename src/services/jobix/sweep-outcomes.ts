import { db } from "@/lib/db";
import { JobixError } from "./client";
import { fetchDialOutcome } from "./fetch-outcome";
import { OUTCOME_GRACE_SECONDS } from "@/services/dial-attempts";

// ---------------------------------------------------------------------------
// Filling in the calls nobody is watching.
//
// A dial's result arrives one of three ways: the flow posts it to the outcome
// webhook, the panel on screen goes and reads it, or nobody is looking and it
// never arrives at all. The third is the common case — somebody places a call,
// closes the tab, and comes back to an account that still says "no interactions
// recorded" three days later.
//
// This is the third way covered. It takes the dials still sitting at "placed",
// asks the platform what happened to each, and puts the answer through the same
// path the webhook uses, so an unattended call produces the same call record,
// the same analysis and the same promise to pay as a watched one.
//
// Three limits keep it from becoming a way to hammer the platform:
//
//   * only dials old enough to plausibly be finished. A call placed twelve
//     seconds ago has not happened yet, and asking costs a request to learn
//     nothing.
//   * only dials young enough to still be findable. Past the cutoff the number
//     has probably been rung again and the "earliest conversation after this
//     minute" join stops being trustworthy, so those are marked as never
//     having reported rather than guessed at.
//   * a budget per sweep. A backlog is worked through over several runs rather
//     than in one burst against somebody else's rate limit.
// ---------------------------------------------------------------------------

/** Below this a call has not finished; asking is a wasted request. */
const SETTLE_SECONDS = 90;

/**
 * Past this a dial is not going to be matched safely, and is written off as
 * never having reported rather than guessed at.
 *
 * Three days rather than a few hours, because this does not necessarily run on
 * a schedule. A deployment whose plan has no room for another cron job sweeps
 * when somebody opens Calls or an account, which on a Friday evening means the
 * next sweep is on Monday — and a promise to pay captured on Friday is exactly
 * the record that must not be thrown away for being late.
 */
const ABANDON_SECONDS = 3 * 24 * 3_600;

const DEFAULT_BUDGET = 25;

export type SweepResult = {
  /** Dials that were still open when the sweep started. */
  considered: number;
  /** Dials the platform had an answer for. */
  filled: number;
  /** Dials it had nothing for yet — they stay open and are tried again. */
  pending: number;
  /** Dials too old to match safely; recorded as never having reported. */
  abandoned: number;
  /** Dials the platform could not be asked about. */
  failed: number;
  /** Left for the next run because the budget ran out. */
  remaining: number;
};

export async function sweepDialOutcomes(
  organizationId: string,
  options: { budget?: number; now?: Date } = {},
): Promise<SweepResult> {
  const budget = options.budget ?? DEFAULT_BUDGET;
  const now = options.now ?? new Date();

  const settledBefore = new Date(now.getTime() - SETTLE_SECONDS * 1000);
  const abandonBefore = new Date(now.getTime() - ABANDON_SECONDS * 1000);

  // Oldest first: a dial that has been waiting longest is the one somebody is
  // most likely to be looking for, and it is also the one closest to falling
  // past the cutoff.
  const open = await db.dialAttempt.findMany({
    where: { organizationId, state: "placed", requestedAt: { lt: settledBefore } },
    orderBy: { requestedAt: "asc" },
    select: { id: true, requestedAt: true },
  });

  const result: SweepResult = {
    considered: open.length,
    filled: 0,
    pending: 0,
    abandoned: 0,
    failed: 0,
    remaining: 0,
  };

  let spent = 0;
  for (const attempt of open) {
    if (attempt.requestedAt < abandonBefore) {
      // Not a failure of the call — a failure to hear about it. The state says
      // exactly that rather than inventing an outcome.
      await db.dialAttempt.update({
        where: { id: attempt.id },
        data: { state: "failed", outcome: "no_outcome_reported", endedAt: now },
      });
      result.abandoned += 1;
      continue;
    }

    if (spent >= budget) {
      result.remaining += 1;
      continue;
    }
    spent += 1;

    try {
      const outcome = await fetchDialOutcome(organizationId, attempt.id);
      if (outcome.found) result.filled += 1;
      else result.pending += 1;
    } catch (err) {
      result.failed += 1;
      // One unreachable dial must not stop the rest of the sweep, but a
      // configuration problem affects all of them equally, so stop on that.
      if (err instanceof JobixError && err.code === "not_configured") break;
    }
  }

  return result;
}

export { SETTLE_SECONDS, ABANDON_SECONDS, OUTCOME_GRACE_SECONDS };
