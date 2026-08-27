import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { sastHour } from "@/services/analytics/classify";
import {
  fetchFlowNodes,
  fetchTranscript,
  pullConversations,
  pullCustomers,
  pullNodeHistory,
  requireWorkspace,
  type JobixConversation,
} from "./api";
import { messagingChannel, nameKey } from "./messaging";
import { persistCustomers } from "./customers";
import { JobixClient, JobixError, loadJobixEnv } from "./client";

// ---------------------------------------------------------------------------
// Ingestion.
//
// Transcript fetching is the bottleneck — one request per call — so the job:
//   * pages conversations first (cheap) and caches them,
//   * fetches only transcripts that are NOT already cached,
//   * runs a bounded number of fetches concurrently,
//   * checkpoints progress after every batch so a run is resumable,
//   * never re-fetches a cached transcript.
//
// Ingestion is gated on the workspace assertion: the same endpoints return a
// plausible dataset from the wrong workspace, so a mismatch aborts before any
// data is written.
// ---------------------------------------------------------------------------

/** Parallel transcript fetches. The endpoint tolerates this comfortably; the
 *  ceiling is the provider's, so it is env-tunable without a deploy. */
const TRANSCRIPT_CONCURRENCY = Number(process.env.JOBIX_TRANSCRIPT_CONCURRENCY ?? 16);

/** Default run budget. The route's maxDuration is 300s; this leaves margin to
 *  checkpoint and respond rather than being killed mid-write. */
const DEFAULT_BUDGET_MS = 240_000;
/** Held back from the transcript phase so customers and messaging can still
 *  run when transcripts finish inside the budget. */
const TAIL_RESERVE_MS = 60_000;

export type IngestOptions = {
  organizationId: string;
  /** Only ingest conversations at or after this instant. */
  since?: Date;
  /** Agents that must be present in the workspace, or the run aborts. */
  expectedAgentNames?: string[];
  campaignId?: string;
  /** Cap transcript fetches for a quick first pass. */
  transcriptLimit?: number;
  /**
   * Skip the transcript phase entirely.
   *
   * Transcripts are one request per call and dominate the time; the call list
   * and the accounts are a handful of requests. Skipping them turns a pull of
   * a few thousand calls from minutes into seconds, at the cost of reach: a
   * call with no transcript counts as not reached, and the analytics screen
   * says so rather than presenting an understated figure as final.
   */
  skipTranscripts?: boolean;
  /**
   * Wall-clock budget for the whole run. The request is killed at the
   * platform's duration ceiling, so the run stops itself before that and
   * reports `interrupted` — a resumable state — instead of being cut off
   * mid-write while still claiming to be running.
   */
  budgetMs?: number;
};

export type IngestProgress = {
  runId: string;
  status: string;
  phase: string;
  conversationsFound: number;
  transcriptsFetched: number;
  transcriptsCached: number;
  transcriptsFailed: number;
  transcriptsPending: number;
  customersFound: number;
  customersCreated: number;
  customersUpdated: number;
  droppedStale: number;
  droppedDuplicate: number;
  messagingEvents: number;
  workspaceNote: string | null;
  error: string | null;
  startedAt: Date;
  finishedAt: Date | null;
};

export function jobixClientOrThrow(): JobixClient {
  const env = loadJobixEnv();
  if (!env) {
    throw new JobixError(
      "Jobix is not configured on the server. Set JOBIX_EMAIL and JOBIX_PASSWORD (the dashboard sign-in) to enable ingestion.",
      "not_configured",
    );
  }
  return new JobixClient(env);
}

const WRITE_CHUNK = 400;

function chunk<T>(items: T[], size: number): T[][] {
  const groups: T[][] = [];
  for (let i = 0; i < items.length; i += size) groups.push(items.slice(i, i + size));
  return groups;
}

/**
 * Store or refresh conversations and return uuid → local row id.
 *
 * A row per round trip does not scale: a book of a few thousand calls spent
 * most of the request budget writing rows that had not changed. New rows go in
 * one createMany per chunk, and an existing row is only written when a mutable
 * field actually differs — so re-running over a settled book costs two reads
 * per chunk and nothing else.
 */
export async function syncConversations(
  organizationId: string,
  conversations: JobixConversation[],
): Promise<Map<string, string>> {
  const ids = new Map<string, string>();

  for (const group of chunk(conversations, WRITE_CHUNK)) {
    const existing = await db.jobixConversation.findMany({
      where: { organizationId, uuid: { in: group.map((c) => c.uuid) } },
      select: {
        id: true,
        uuid: true,
        status: true,
        durationSeconds: true,
        conversion: true,
        voicemailFlag: true,
        agentName: true,
        flowName: true,
      },
    });
    const byUuid = new Map(existing.map((row) => [row.uuid, row]));

    const missing = group.filter((c) => !byUuid.has(c.uuid));
    if (missing.length > 0) {
      await db.jobixConversation.createMany({
        data: missing.map((c) => ({
          organizationId,
          uuid: c.uuid,
          externalId: c.id || null,
          phone: c.phone,
          contactName: c.contactName,
          contactUuid: c.contactUuid,
          agentUuid: c.agentUuid,
          agentName: c.agentName,
          flowName: c.flowName,
          durationSeconds: c.durationSeconds,
          status: c.status,
          conversion: c.conversion,
          voicemailFlag: c.voicemailFlag,
          startedAt: c.createdAt,
          sastHour: sastHour(c.createdAt),
        })),
        skipDuplicates: true,
      });
      // createMany does not return ids, so read back the ones just written.
      const created = await db.jobixConversation.findMany({
        where: { organizationId, uuid: { in: missing.map((c) => c.uuid) } },
        select: { id: true, uuid: true },
      });
      for (const row of created) ids.set(row.uuid, row.id);
    }

    for (const c of group) {
      const row = byUuid.get(c.uuid);
      if (!row) continue;
      ids.set(c.uuid, row.id);
      const changed =
        row.status !== c.status ||
        row.durationSeconds !== c.durationSeconds ||
        row.conversion !== c.conversion ||
        row.voicemailFlag !== c.voicemailFlag ||
        row.agentName !== c.agentName ||
        row.flowName !== c.flowName;
      if (!changed) continue;
      await db.jobixConversation.update({
        where: { id: row.id },
        data: {
          status: c.status,
          durationSeconds: c.durationSeconds,
          conversion: c.conversion,
          voicemailFlag: c.voicemailFlag,
          agentName: c.agentName,
          flowName: c.flowName,
        },
      });
    }
  }

  return ids;
}

/** Run a bounded number of async tasks at a time. */
async function pool<T>(items: T[], limit: number, worker: (item: T) => Promise<void>): Promise<void> {
  let index = 0;
  const runners = Array.from({ length: Math.min(limit, items.length) }, async () => {
    while (index < items.length) {
      const current = items[index++];
      await worker(current);
    }
  });
  await Promise.all(runners);
}

/**
 * Pull and store flow node-history events (WhatsApp/SMS sends, filter
 * branches).
 *
 * Requires a configured flow — without JOBIX_FLOW_UUID there is no endpoint to
 * ask, so the phase is skipped and reports zero rather than inventing state.
 * Node names come from the flow definition so a send can be labelled by
 * channel; when the definition cannot be read the events are still stored with
 * channel "other".
 */
async function ingestNodeHistory(
  organizationId: string,
  client: JobixClient,
  since: Date | undefined,
  update: (data: Record<string, unknown>) => Promise<unknown>,
): Promise<number> {
  const flowUuid = client.flowUuid;
  if (!flowUuid) return 0;

  let nodeNames = new Map<number, string | null>();
  try {
    const nodes = await fetchFlowNodes(client, flowUuid);
    nodeNames = new Map(nodes.map((n) => [n.companyNodeId, n.name]));
  } catch (err) {
    // A missing flow definition costs labels, not data.
    console.warn("[jobix/ingest] flow nodes unavailable, channels default to other:", err);
  }

  const events = await pullNodeHistory(client, flowUuid, { since });
  let stored = 0;
  let sinceCheckpoint = 0;

  for (const event of events) {
    const nodeName = nodeNames.get(event.companyNodeId) ?? null;
    try {
      await db.jobixNodeEvent.create({
        data: {
          organizationId,
          flowUuid,
          companyNodeId: event.companyNodeId,
          nodeName,
          channel: messagingChannel(nodeName),
          status: event.status,
          succeeded: event.succeeded,
          failed: event.failed,
          outputSocketId: event.outputSocketId,
          matchedFilter: event.matchedFilter,
          customerName: event.customerName,
          customerKey: nameKey(event.customerName),
          occurredAt: event.createdAt,
        },
      });
      stored += 1;
    } catch {
      // Unique violation: Jobix issues no event ids, so identity is the event's
      // content. A repeat is the same event seen again, not new activity.
    }
    sinceCheckpoint += 1;
    if (sinceCheckpoint >= 100) {
      sinceCheckpoint = 0;
      await update({ messagingEvents: stored });
    }
  }
  return stored;
}

/**
 * The Jobix credentials are deployment-global environment variables, so they
 * cannot be partitioned between tenants: every organization would be pulling
 * the same workspace into itself. Ingestion and calling therefore refuse to
 * run on a deployment with more than one organization.
 */
export async function assertSingleOrganization(): Promise<void> {
  const organizations = await db.organization.count();
  if (organizations > 1) {
    throw new JobixError(
      "This deployment has multiple organizations, but the Jobix connection is deployment-wide. Per-organization integration settings are required before ingestion or calling can run.",
      "rejected",
    );
  }
}

export async function runIngestion(options: IngestOptions): Promise<IngestProgress> {
  const { organizationId } = options;
  await assertSingleOrganization();
  const client = jobixClientOrThrow();
  const deadline = Date.now() + (options.budgetMs ?? DEFAULT_BUDGET_MS);

  const run = await db.ingestionRun.create({
    data: { organizationId, campaignId: options.campaignId, status: "running", phase: "conversations" },
  });

  const update = (data: Record<string, unknown>) =>
    db.ingestionRun.update({ where: { id: run.id }, data });

  try {
    // --- workspace gate: refuse to ingest from the wrong workspace ---
    const health = await requireWorkspace(client, options.expectedAgentNames ?? []);
    await update({ workspaceNote: health.message });

    // --- conversations ---
    let conversationsTruncated = false;
    const { conversations } = await pullConversations(client, {
      since: options.since,
      onPage: async ({ pulled }) => {
        await update({ conversationsFound: pulled });
        // Leave the tail of the budget for writing and transcripts.
        if (Date.now() > deadline - TAIL_RESERVE_MS) {
          conversationsTruncated = true;
          return false;
        }
      },
    });
    await update({ conversationsFound: conversations.length, phase: "transcripts" });

    const localIds = await syncConversations(organizationId, conversations);

    // --- transcripts: only what is not already cached ---
    const cached = await db.jobixTranscript.findMany({
      where: { organizationId, conversationUuid: { in: conversations.map((c) => c.uuid) } },
      select: { conversationUuid: true },
    });
    const cachedSet = new Set(cached.map((t) => t.conversationUuid));
    let pending = conversations.filter((c) => !cachedSet.has(c.uuid));
    // Counted before any cap, so "pending" reported to the UI is the real
    // amount of work left, not what this slice chose to attempt.
    const uncachedTotal = pending.length;
    if (options.transcriptLimit) pending = pending.slice(0, options.transcriptLimit);

    await update({ transcriptsCached: cachedSet.size });

    let fetched = 0;
    let failed = 0;
    let sinceCheckpoint = 0;
    let ranOutOfTime = false;

    // The fast pass records what is outstanding and moves on, so the numbers
    // are on screen in seconds and a later run fills the transcripts in.
    const wanted = options.skipTranscripts ? [] : pending;

    await pool(wanted, TRANSCRIPT_CONCURRENCY, async (conversation) => {
      // Stop cleanly at the budget rather than being killed mid-write. What is
      // already stored stays stored, and the next run skips it.
      if (Date.now() > deadline - TAIL_RESERVE_MS) {
        ranOutOfTime = true;
        return;
      }
      const conversationId = localIds.get(conversation.uuid);
      if (!conversationId) return;
      try {
        const { turns, summary } = await fetchTranscript(client, conversation.uuid);
        const reached =
          summary.userTurns > 0 &&
          !(/(voicemail|leave a message|after the tone|not available|unavailable|please leave|voice mail|mailbox|subscriber|switched off|does not exist|try again later|answering machine|record your message|cannot be reached|no longer in service)/i.test(
            summary.userText,
          ) &&
            summary.userWords < 15);

        await db.jobixTranscript.upsert({
          where: { organizationId_conversationUuid: { organizationId, conversationUuid: conversation.uuid } },
          create: {
            organizationId,
            conversationId,
            conversationUuid: conversation.uuid,
            turns: JSON.stringify(turns).slice(0, 200_000),
            userTurns: summary.userTurns,
            userWords: summary.userWords,
            userText: summary.userText.slice(0, 20_000),
            reached,
          },
          update: {},
        });
        fetched += 1;
      } catch (err) {
        failed += 1;
        if (err instanceof JobixError && err.code === "unauthorized") throw err;
      }
      sinceCheckpoint += 1;
      if (sinceCheckpoint >= 25) {
        sinceCheckpoint = 0;
        await update({ transcriptsFetched: fetched, transcriptsFailed: failed });
      }
    });

    const stillToFetch = Math.max(0, uncachedTotal - fetched);
    await update({ transcriptsFetched: fetched, transcriptsFailed: failed, transcriptsPending: stillToFetch });

    // Out of budget: report an interrupted run so the caller can continue,
    // rather than starting a phase that cannot finish.
    if (ranOutOfTime || conversationsTruncated || Date.now() > deadline - TAIL_RESERVE_MS) {
      await update({ status: "interrupted", phase: "transcripts", finishedAt: new Date() });
      return (await getIngestProgress(organizationId, run.id))!;
    }

    await update({ phase: "customers" });

    // --- customers (accounts + outcomes), stale-filtered and deduped ---
    let customersTruncated = false;
    const { customers, droppedStale, droppedDuplicate } = await pullCustomers(client, {
      campaignStart: options.since,
      onPage: async ({ pulled }) => {
        await update({ customersFound: pulled });
        if (Date.now() > deadline) {
          customersTruncated = true;
          return false;
        }
      },
    });
    // Persist what was pulled: debtors matched or created by phone, and
    // confirmed PTPs written as real promise rows so the commitments range and
    // the work queue see them.
    const sync = await persistCustomers(organizationId, customers);
    await update({
      customersFound: customers.length,
      customersCreated: sync.created,
      customersUpdated: sync.updated,
      droppedStale,
      droppedDuplicate,
      phase: "messaging",
    });

    if (customersTruncated) {
      await update({ status: "interrupted", phase: "customers", finishedAt: new Date() });
      return (await getIngestProgress(organizationId, run.id))!;
    }

    // --- messaging: non-voice flow steps (WhatsApp/SMS) from node history ---
    // Only possible when a flow is configured; skipped, never faked, otherwise.
    const messagingEvents = await ingestNodeHistory(organizationId, client, options.since, update);

    await update({
      messagingEvents,
      phase: "done",
      status: "completed",
      finishedAt: new Date(),
      cursor: conversations[0]?.uuid ?? null,
    });

    await audit({
      organizationId,
      actorType: "system",
      action: "jobix.ingested",
      entityType: "ingestion_run",
      entityId: run.id,
      detail: {
        conversations: conversations.length,
        transcriptsFetched: fetched,
        transcriptsCached: cachedSet.size,
        transcriptsFailed: failed,
        transcriptsPending: stillToFetch,
        customers: customers.length,
        customersCreated: sync.created,
        customersUpdated: sync.updated,
        customersSkippedNoPhone: sync.skippedNoPhone,
        promisesCreated: sync.promisesCreated,
        promisesUpdated: sync.promisesUpdated,
        droppedStale,
        droppedDuplicate,
        messagingEvents,
      },
    });

    return (await getIngestProgress(organizationId, run.id))!;
  } catch (err) {
    const message = err instanceof Error ? err.message : "ingestion failed";
    await update({ status: "failed", error: message.slice(0, 500), finishedAt: new Date() });
    console.error("[jobix/ingest] failed:", err);
    throw err;
  }
}

/**
 * Recover a run whose process was killed.
 *
 * The platform can terminate the request without warning, leaving a row that
 * says "running" forever and a panel that spins for good. Every phase
 * checkpoints, so a run that has not been touched for longer than any real gap
 * between checkpoints is dead — mark it interrupted, which is the resumable
 * state, rather than showing it as alive.
 */
export const STALE_RUN_MS = 180_000;

export async function reconcileStalledRun(organizationId: string): Promise<void> {
  const stale = await db.ingestionRun.findFirst({
    where: {
      organizationId,
      status: "running",
      updatedAt: { lt: new Date(Date.now() - STALE_RUN_MS) },
    },
    select: { id: true },
  });
  if (!stale) return;
  await db.ingestionRun.update({
    where: { id: stale.id },
    data: {
      status: "interrupted",
      finishedAt: new Date(),
      error:
        "The run was cut off by the request time limit before it could finish. Nothing already stored was lost — continue to pick up where it stopped.",
    },
  });
}

export async function getIngestProgress(
  organizationId: string,
  runId?: string,
): Promise<IngestProgress | null> {
  const run = runId
    ? await db.ingestionRun.findFirst({ where: { id: runId, organizationId } })
    : await db.ingestionRun.findFirst({ where: { organizationId }, orderBy: { startedAt: "desc" } });
  if (!run) return null;
  return {
    runId: run.id,
    status: run.status,
    phase: run.phase,
    conversationsFound: run.conversationsFound,
    transcriptsFetched: run.transcriptsFetched,
    transcriptsCached: run.transcriptsCached,
    transcriptsFailed: run.transcriptsFailed,
    transcriptsPending: run.transcriptsPending,
    customersFound: run.customersFound,
    customersCreated: run.customersCreated,
    customersUpdated: run.customersUpdated,
    droppedStale: run.droppedStale,
    droppedDuplicate: run.droppedDuplicate,
    messagingEvents: run.messagingEvents,
    workspaceNote: run.workspaceNote,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
