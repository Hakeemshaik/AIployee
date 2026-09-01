import { randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { JobixClient, JobixError, resolveJobixEnv } from "@/services/jobix/client";
import { save } from "@/services/jobix/push";
import { checkEngineWindow } from "./window";
import { classifyBatch } from "./classify";

// ---------------------------------------------------------------------------
// Feeding a batch to the platform, slowly.
//
// On an insert-started flow the WRITE is the dial: the moment a customer row
// lands, the phone rings. So concurrency control is write control — a batch of
// 200 written in one burst is 200 near-simultaneous dials, and the measured
// result of that is a 55% zero-duration rate as the carrier drops them.
//
// The engine therefore drips: each tick writes at most
// (max_concurrency × minutes since the last tick) rows, which spreads a batch
// of 200 at the default concurrency of 4 across ~50 minutes of ticks. The tick
// also ingests what has happened so far, so the zero-duration monitor can
// pause a failing batch after the first 50 calls instead of burning the other
// 150 into a dead carrier path.
// ---------------------------------------------------------------------------

const EXPECTED_AGENT = () => process.env.JOBIX_EXPECTED_AGENT || "Siya";

/** Batch is complete when everyone has an attempt and nothing new for 5 min. */
const QUIET_MINUTES = 5;

export class EngineGuardError extends Error {}

async function assertWorkspace(client: JobixClient): Promise<void> {
  // requireWorkspace is the same gate the ingestion pipeline runs — it throws
  // with the agent list when the expected name is missing.
  const { requireWorkspace } = await import("@/services/jobix/api");
  try {
    await requireWorkspace(client, [EXPECTED_AGENT()]);
  } catch (err) {
    throw new EngineGuardError(
      err instanceof Error ? err.message : `Wrong workspace — expected agent "${EXPECTED_AGENT()}".`,
    );
  }
}

/**
 * §3.2 — every reason a batch may not start, each with its own sentence.
 * Returns the loaded batch and campaign so the caller does not read twice.
 */
export async function startBatch(organizationId: string, batchId: string, userId: string) {
  const batch = await db.engineBatch.findFirst({ where: { id: batchId, organizationId } });
  if (!batch) throw new EngineGuardError("No such batch.");
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: batch.campaignId } });

  if (batch.status !== "pending") {
    throw new EngineGuardError(`This batch is ${batch.status}, not pending.`);
  }

  const window = checkEngineWindow(campaign.callingHoursStart, campaign.callingHoursEnd);
  if (!window.allowed) throw new EngineGuardError(window.reason);

  if (campaign.engineBlock) {
    throw new EngineGuardError(`A guard is blocking dialling: ${campaign.engineBlock}.`);
  }

  // Sequential: B2 waits for B1. A round is worked front to back because the
  // batches are cut in money order and the zero-duration monitor needs a
  // finished batch to have meant something.
  const predecessor = await db.engineBatch.findFirst({
    where: { campaignId: batch.campaignId, round: batch.round, index: { lt: batch.index }, status: { not: "complete" } },
    orderBy: { index: "asc" },
  });
  if (predecessor) {
    throw new EngineGuardError(`Batch ${predecessor.code} must finish first (it is ${predecessor.status}).`);
  }

  // Lock 2 — one live attempt per account per round, asserted for the whole
  // batch before anything is queued. The partial unique index backs this up.
  const accountIds = JSON.parse(batch.accountIds) as string[];
  const already = await db.engineAttempt.count({
    where: { accountId: { in: accountIds }, round: batch.round, voided: false },
  });
  if (already > 0) {
    throw new EngineGuardError(
      `${already} account(s) in this batch already have a call in round ${batch.round}. The whole batch is refused — this is the duplicate-dial lock.`,
    );
  }

  const env = await resolveJobixEnv();
  if (!env || !env.companyKey) {
    throw new EngineGuardError("Jobix is not configured — connect it under Settings first.");
  }
  const client = new JobixClient(env);
  await assertWorkspace(client);

  await db.engineBatch.update({
    where: { id: batch.id },
    data: { status: "calling", startedAt: new Date() },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "engine.batch_started",
    entityType: "engine_batch",
    entityId: batch.id,
    detail: { code: batch.code, accounts: batch.accountCount, arrears: batch.arrears },
  });

  // The first rows go out immediately; the poller carries on from here.
  return tickBatch(organizationId, batch.id);
}

export type TickResult = {
  batchId: string;
  code: string;
  status: string;
  uploaded: number;
  total: number;
  attempts: number;
  zeroRate: number | null;
  pausedReason: string | null;
  finished: boolean;
};

/**
 * One heartbeat of a live batch: write the next few rows, ingest what has
 * happened, run the guards, decide whether the batch is done. Called by the
 * page's poller every couple of minutes and safe to call twice — every write
 * is keyed and every ingest is an upsert.
 */
export async function tickBatch(organizationId: string, batchId: string): Promise<TickResult> {
  const batch = await db.engineBatch.findFirstOrThrow({ where: { id: batchId, organizationId } });
  const campaign = await db.campaign.findFirstOrThrow({ where: { id: batch.campaignId } });
  const accountIds = JSON.parse(batch.accountIds) as string[];

  const view = async (status = batch.status, pausedReason = batch.pausedReason): Promise<TickResult> => {
    const attempts = await db.engineAttempt.count({ where: { batchId: batch.id, voided: false } });
    const fresh = await db.engineBatch.findFirstOrThrow({ where: { id: batch.id } });
    return {
      batchId: batch.id,
      code: batch.code,
      status,
      uploaded: fresh.uploadedCount,
      total: batch.accountCount,
      attempts,
      zeroRate: fresh.zeroRate,
      pausedReason,
      finished: status === "complete",
    };
  };

  if (batch.status !== "calling") return view();

  // The legal window applies to every dial, not only the first: a batch that
  // straddles 21:00 or midnight-into-Sunday stops writing and waits.
  const window = checkEngineWindow(campaign.callingHoursStart, campaign.callingHoursEnd);

  // --- 1 · drip the next rows -------------------------------------------------
  if (window.allowed && batch.uploadedCount < accountIds.length) {
    const sinceStart = batch.startedAt ? (Date.now() - batch.startedAt.getTime()) / 60_000 : 0;
    // Never ahead of the pace line: at minute M, at most concurrency×M rows
    // may have been written, whatever the tick cadence did.
    const allowedByNow = Math.max(
      campaign.maxConcurrency,
      Math.floor(sinceStart * campaign.maxConcurrency),
    );
    const target = Math.min(accountIds.length, allowedByNow);
    const toWrite = accountIds.slice(batch.uploadedCount, target);

    if (toWrite.length > 0) {
      const env = await resolveJobixEnv();
      if (!env || !env.companyKey) throw new JobixError("Jobix is not configured.", "not_configured");
      const client = new JobixClient(env);
      const accounts = await db.engineAccount.findMany({ where: { id: { in: toWrite } } });
      const byId = new Map(accounts.map((a) => [a.id, a]));

      let written = batch.uploadedCount;
      for (const id of toWrite) {
        const account = byId.get(id);
        if (!account || !account.phone) {
          written += 1;
          continue;
        }
        // The proven write shape: identity in main, the dialling fields in
        // values, the flag in both `call` and `all`, attribution in `batch`.
        // Every key snake_case, spelled exactly as the agent prompt reads it.
        //
        // The suid on the wire is a FRESH uuid per dial, not the account's own:
        // this workspace's flow starts on INSERT, and a repeated suid is an
        // update, which never rings. The account's stable suid stays ours;
        // results are matched by phone within the batch window, and the batch
        // code rides in `batch` for attribution.
        await save(client, env.companyKey, {
          suid: randomUUID(),
          timezone: "Africa/Johannesburg",
          phone: account.phone,
          name: account.fullName,
        }, {
          full_name: account.fullName,
          greeting_name: account.greetingName,
          total_due: account.totalDue,
          arrears_amount: account.totalDue,
          ...(account.unitNumber ? { unit_number: account.unitNumber } : {}),
          ...(account.buildingName ? { building_name: account.buildingName } : {}),
          ...(account.tenantCode ? { tenant_code: account.tenantCode } : {}),
          ...(account.email ? { email: account.email } : {}),
          batch: batch.code,
          call: batch.code,
          all: batch.code,
        });
        written += 1;
        // The cursor advances per row, so a crash mid-drip resumes instead of
        // re-writing (and re-dialling) the rows that already went.
        await db.engineBatch.update({ where: { id: batch.id }, data: { uploadedCount: written } });
        await db.engineAccount.update({ where: { id }, data: { state: "dialling" } });
      }
    }
  }

  // --- 2 · ingest and classify what has happened so far -----------------------
  const guard = await classifyBatch(organizationId, batch.id);

  // --- 3 · zero-duration monitor (§7.4): pause a failing batch early ----------
  if (guard.attempts >= 20 && guard.zeroRate > 0.35 && batch.uploadedCount < accountIds.length) {
    await db.engineBatch.update({
      where: { id: batch.id },
      data: {
        status: "paused",
        zeroRate: guard.zeroRate,
        pausedReason: `${Math.round(guard.zeroRate * 100)}% of the first ${guard.attempts} calls connected for 0 seconds. That is a delivery problem, not bad numbers — lower the concurrency and resume.`,
      },
    });
    return view("paused", `${Math.round(guard.zeroRate * 100)}% zero-duration — paused before burning the rest of the batch.`);
  }

  await db.engineBatch.update({ where: { id: batch.id }, data: { zeroRate: guard.zeroRate } });

  // --- 4 · completion: everyone attempted, and quiet for five minutes ---------
  const attempted = await db.engineAttempt.groupBy({
    by: ["accountId"],
    where: { batchId: batch.id, voided: false },
  });
  const everyoneAttempted =
    batch.uploadedCount >= accountIds.length && attempted.length >= accountIds.length;
  const quiet =
    guard.newestAttemptAt === null ||
    Date.now() - guard.newestAttemptAt.getTime() > QUIET_MINUTES * 60_000;

  if (everyoneAttempted && quiet) {
    await db.engineBatch.update({
      where: { id: batch.id },
      data: { status: "complete", finishedAt: new Date() },
    });
    // Last batch of the round → the round is over.
    const open = await db.engineBatch.count({
      where: { campaignId: batch.campaignId, round: batch.round, status: { not: "complete" } },
    });
    if (open === 0) {
      await db.campaign.update({
        where: { id: batch.campaignId },
        data: { engineStatus: "between_rounds" },
      });
      // The round is over — run the balance guard now, so a drifting quote
      // blocks round N+1 rather than being discovered in its transcripts.
      const { checkBalanceDrift } = await import("./guards");
      await checkBalanceDrift(organizationId, batch.campaignId, batch.round).catch(() => null);
    }
    return view("complete", null);
  }

  return view("calling", null);
}

/** Resume a paused batch, optionally at a lower concurrency. */
export async function resumeBatch(
  organizationId: string,
  batchId: string,
  userId: string,
  options: { maxConcurrency?: number; voidAndRerun?: boolean } = {},
): Promise<void> {
  const batch = await db.engineBatch.findFirstOrThrow({ where: { id: batchId, organizationId } });
  if (batch.status !== "paused") throw new EngineGuardError("Only a paused batch can be resumed.");

  await db.$transaction(async (tx) => {
    if (options.maxConcurrency) {
      await tx.campaign.update({
        where: { id: batch.campaignId },
        data: { maxConcurrency: Math.max(1, Math.min(8, options.maxConcurrency)) },
      });
    }
    if (options.voidAndRerun) {
      // §4.5: a delivery-failure run does not count as an attempt. The record
      // of the dials stays; the lock and the caps let go of them.
      const touched = await tx.engineAttempt.findMany({
        where: { batchId: batch.id },
        select: { accountId: true },
      });
      await tx.engineAttempt.updateMany({ where: { batchId: batch.id }, data: { voided: true } });
      // The rollup counters were incremented when these classified; recompute
      // them from what still counts, so the attempt cap forgets this run too.
      for (const { accountId } of touched) {
        const live = await tx.engineAttempt.count({ where: { accountId, voided: false } });
        await tx.engineAccount.update({
          where: { id: accountId },
          data: { attempts: live, state: "queued" },
        });
      }
      await tx.engineBatch.update({
        where: { id: batch.id },
        data: { status: "calling", pausedReason: null, uploadedCount: 0, countsAttempt: false, startedAt: new Date() },
      });
    } else {
      await tx.engineBatch.update({
        where: { id: batch.id },
        data: { status: "calling", pausedReason: null, startedAt: new Date() },
      });
    }
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: options.voidAndRerun ? "engine.batch_rerun" : "engine.batch_resumed",
    entityType: "engine_batch",
    entityId: batchId,
    detail: { maxConcurrency: options.maxConcurrency ?? null },
  });
}
