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

const TRANSCRIPT_CONCURRENCY = 12;

export type IngestOptions = {
  organizationId: string;
  /** Only ingest conversations at or after this instant. */
  since?: Date;
  /** Agents that must be present in the workspace, or the run aborts. */
  expectedAgentNames?: string[];
  campaignId?: string;
  /** Cap transcript fetches for a quick first pass. */
  transcriptLimit?: number;
};

export type IngestProgress = {
  runId: string;
  status: string;
  phase: string;
  conversationsFound: number;
  transcriptsFetched: number;
  transcriptsCached: number;
  transcriptsFailed: number;
  customersFound: number;
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
      "Jobix is not configured on the server. Set JOBIX_TOKEN (and JOBIX_BASE) to enable ingestion.",
      "not_configured",
    );
  }
  return new JobixClient(env);
}

/** Store or refresh a conversation, returning its local row id. */
async function upsertConversation(organizationId: string, c: JobixConversation) {
  return db.jobixConversation.upsert({
    where: { organizationId_uuid: { organizationId, uuid: c.uuid } },
    create: {
      organizationId,
      uuid: c.uuid,
      externalId: c.id || null,
      phone: c.phone,
      contactName: c.contactName,
      agentUuid: c.agentUuid,
      agentName: c.agentName,
      flowName: c.flowName,
      durationSeconds: c.durationSeconds,
      status: c.status,
      conversion: c.conversion,
      voicemailFlag: c.voicemailFlag,
      startedAt: c.createdAt,
      sastHour: sastHour(c.createdAt),
    },
    update: {
      durationSeconds: c.durationSeconds,
      status: c.status,
      conversion: c.conversion,
      voicemailFlag: c.voicemailFlag,
      agentName: c.agentName,
      flowName: c.flowName,
    },
    select: { id: true, uuid: true },
  });
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

export async function runIngestion(options: IngestOptions): Promise<IngestProgress> {
  const { organizationId } = options;
  const client = jobixClientOrThrow();

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
    const { conversations } = await pullConversations(client, {
      since: options.since,
      onPage: async ({ pulled }) => {
        await update({ conversationsFound: pulled });
      },
    });
    await update({ conversationsFound: conversations.length, phase: "transcripts" });

    const localIds = new Map<string, string>();
    for (const c of conversations) {
      const row = await upsertConversation(organizationId, c);
      localIds.set(c.uuid, row.id);
    }

    // --- transcripts: only what is not already cached ---
    const cached = await db.jobixTranscript.findMany({
      where: { organizationId, conversationUuid: { in: conversations.map((c) => c.uuid) } },
      select: { conversationUuid: true },
    });
    const cachedSet = new Set(cached.map((t) => t.conversationUuid));
    let pending = conversations.filter((c) => !cachedSet.has(c.uuid));
    if (options.transcriptLimit) pending = pending.slice(0, options.transcriptLimit);

    await update({ transcriptsCached: cachedSet.size });

    let fetched = 0;
    let failed = 0;
    let sinceCheckpoint = 0;

    await pool(pending, TRANSCRIPT_CONCURRENCY, async (conversation) => {
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
          where: { conversationUuid: conversation.uuid },
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

    await update({ transcriptsFetched: fetched, transcriptsFailed: failed, phase: "customers" });

    // --- customers (accounts + outcomes), stale-filtered and deduped ---
    const { customers, droppedStale, droppedDuplicate } = await pullCustomers(client, {
      campaignStart: options.since,
    });
    await update({
      customersFound: customers.length,
      droppedStale,
      droppedDuplicate,
      phase: "messaging",
    });

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
        customers: customers.length,
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
    customersFound: run.customersFound,
    droppedStale: run.droppedStale,
    droppedDuplicate: run.droppedDuplicate,
    messagingEvents: run.messagingEvents,
    workspaceNote: run.workspaceNote,
    error: run.error,
    startedAt: run.startedAt,
    finishedAt: run.finishedAt,
  };
}
