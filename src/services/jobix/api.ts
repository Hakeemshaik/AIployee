import {
  assertFilter,
  CONVERSATIONS_MAX_PAGE_SIZE,
  CUSTOMERS_MAX_PAGE_SIZE,
  guardConversationFilters,
  JobixClient,
  JobixError,
  unwrapBoolean,
  unwrapField,
  unwrapNumber,
  type PagedMeta,
} from "./client";
import { summariseTranscript, type TranscriptSummary } from "@/services/analytics/classify";

// ---------------------------------------------------------------------------
// Typed reads over the Jobix dashboard API.
// ---------------------------------------------------------------------------

export type JobixConversation = {
  id: number;
  uuid: string;
  channel: string | null;
  contactName: string | null;
  contactUuid: string | null;
  phone: string;
  durationSeconds: number;
  status: number | null;
  conversion: boolean;
  /** Provider flag — unreliable (164 false positives in one campaign). */
  voicemailFlag: boolean;
  actions: number;
  createdAt: Date;
  agentUuid: string | null;
  agentName: string | null;
  flowId: number | null;
  flowName: string | null;
};

type RawConversation = Record<string, unknown> & {
  contact?: { uuid?: string; name?: string };
  agent?: { uuid?: string; name?: string };
};

function toConversation(row: RawConversation): JobixConversation | null {
  const uuid = row.uuid ? String(row.uuid) : null;
  const phone = row.phone_number ? String(row.phone_number) : null;
  if (!uuid || !phone) return null;
  return {
    id: Number(row.id ?? 0),
    uuid,
    channel: row.channel ? String(row.channel) : null,
    contactName: row.contact?.name ?? null,
    contactUuid: row.contact?.uuid ?? null,
    phone,
    // Talk time, not occupancy: a zero-duration call still consumed ring time.
    durationSeconds: Math.max(0, Math.round(Number(row.duration ?? 0)) || 0),
    status: row.status === undefined || row.status === null ? null : Number(row.status),
    conversion: row.conversion === true,
    voicemailFlag: row.voicemail === true,
    actions: Number(row.actions ?? 0),
    createdAt: new Date(String(row.created_at ?? Date.now())),
    agentUuid: row.agent?.uuid ?? null,
    agentName: row.agent?.name ?? null,
    flowId: row.flow_id === undefined || row.flow_id === null ? null : Number(row.flow_id),
    flowName: row.flow_name ? String(row.flow_name) : null,
  };
}

export type ConversationPullOptions = {
  /** Stop once a page is entirely older than this. */
  since?: Date;
  /** Hard ceiling on pages, so a runaway pull cannot spin forever. */
  maxPages?: number;
  /** Only these filters actually work; anything else throws. */
  filters?: { phone?: string; agents?: string };
  /** Called after each page so an ingestion can checkpoint. */
  /** Return false to stop paging (used to stay inside a run budget). */
  onPage?: (info: {
    page: number;
    pulled: number;
    meta: PagedMeta | null;
  }) => void | boolean | Promise<void | boolean>;
};

/**
 * Pull conversations, newest-first by our own sort.
 *
 * The API's order is not reliably newest-first, so "recent" is never inferred
 * from page 1: the requested window is pulled and sorted here.
 */
export async function pullConversations(
  client: JobixClient,
  options: ConversationPullOptions = {},
): Promise<{ conversations: JobixConversation[]; totalCount: number | null }> {
  if (options.filters) guardConversationFilters(options.filters);

  const collected: JobixConversation[] = [];
  let totalCount: number | null = null;
  const maxPages = options.maxPages ?? 200;

  for (let page = 1; page <= maxPages; page++) {
    const payload = await client.get<{ data?: RawConversation[]; meta?: PagedMeta }>("/api/conversations", {
      page, // 1-indexed
      page_size: CONVERSATIONS_MAX_PAGE_SIZE, // 100 → HTTP 500
      ...(options.filters?.phone ? { phone: options.filters.phone } : {}),
      ...(options.filters?.agents ? { agents: options.filters.agents } : {}),
    });
    const rows = payload.data ?? [];
    if (payload.meta) totalCount = payload.meta.totalCount;
    if (rows.length === 0) break;

    const parsed = rows.map(toConversation).filter((c): c is JobixConversation => c !== null);

    // Verify the filter was honoured rather than silently ignored.
    if (options.filters?.phone) {
      const wanted = options.filters.phone.replace(/[^\d+]/g, "");
      assertFilter(parsed, (c) => c.phone.replace(/[^\d+]/g, "").endsWith(wanted.slice(-9)), "phone");
    }
    if (options.filters?.agents) {
      assertFilter(parsed, (c) => c.agentUuid === options.filters!.agents, "agents");
    }

    collected.push(...parsed);
    // A hook returning false stops paging — used to stay inside a run budget.
    if ((await options.onPage?.({ page, pulled: collected.length, meta: payload.meta ?? null })) === false) {
      break;
    }

    // Because ordering is unreliable, only stop when the WHOLE page predates
    // the floor — never on the first old row.
    if (options.since && parsed.length > 0 && parsed.every((c) => c.createdAt < options.since!)) break;
    if (payload.meta && !payload.meta.hasNextPage) break;
  }

  const conversations = collected
    .filter((c) => !options.since || c.createdAt >= options.since)
    .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  return { conversations, totalCount };
}

// --- transcripts ------------------------------------------------------------

export type TranscriptTurn = { role: "user" | "assistant"; text: string };

/**
 * Fetch one transcript.
 * The call_uuid query param is required and is the same uuid; without it the
 * API returns 422. Turn text arrives in `content` or `text` depending on the
 * path, so both are handled.
 */
export async function fetchTranscript(
  client: JobixClient,
  conversationUuid: string,
): Promise<{ turns: TranscriptTurn[]; summary: TranscriptSummary }> {
  const payload = await client.get<unknown>(
    `/api/conversations/${conversationUuid}/transcription`,
    { call_uuid: conversationUuid },
  );

  const rawTurns = (() => {
    if (Array.isArray(payload)) return payload as Record<string, unknown>[];
    if (payload && typeof payload === "object") {
      const obj = payload as Record<string, unknown>;
      for (const key of ["data", "turns", "messages", "transcription", "transcript"]) {
        const candidate = obj[key];
        if (Array.isArray(candidate)) return candidate as Record<string, unknown>[];
        if (candidate && typeof candidate === "object") {
          const nested = (candidate as Record<string, unknown>).turns ?? (candidate as Record<string, unknown>).messages;
          if (Array.isArray(nested)) return nested as Record<string, unknown>[];
        }
      }
    }
    return [];
  })();

  const turns: TranscriptTurn[] = rawTurns
    .map((turn) => {
      const role = String(turn.role ?? turn.speaker ?? "").toLowerCase();
      const text = String(turn.content ?? turn.text ?? turn.message ?? "").trim();
      if (!text) return null;
      // "user" is the tenant; anything else is treated as the agent.
      return { role: role === "user" ? ("user" as const) : ("assistant" as const), text };
    })
    .filter((t): t is TranscriptTurn => t !== null);

  return {
    turns,
    summary: summariseTranscript(
      conversationUuid,
      turns.map((t) => ({ role: t.role, content: t.text })),
    ),
  };
}

// --- customers (accounts + outcomes) ---------------------------------------

export type JobixCustomer = {
  id: number;
  uuid: string;
  phone: string;
  name: string | null;
  unit: string | null;
  building: string | null;
  totalDue: number | null;
  ptpConfirmed: boolean;
  ptpAmount: number | null;
  disputed: boolean;
  paidClaimed: boolean;
  escalated: boolean;
  doNotCall: boolean;
  /** A person answered, but not the account holder. A contact, never an RPC. */
  wrongPerson: boolean;
  callBatch: string | null;
  /** The raw `call` field — the flag the flow's entry filter reads. Kept apart
   *  from callBatch so "is this record armed to dial" can be answered. */
  callFlag: string | null;
  /** When the provider last wrote to this record. */
  modifiedAt: Date | null;
  raw: Record<string, unknown>;
};

function toCustomer(row: Record<string, unknown>): JobixCustomer | null {
  const uuid = row.uuid ? String(row.uuid) : null;
  const phone = row.phone ? String(row.phone) : null;
  if (!uuid || !phone) return null;
  const fields = (row.fields ?? {}) as Record<string, unknown>;
  const modifyRaw = unwrapField(fields._modify_time) ?? unwrapField(row.updated_at);
  const modifiedAt = modifyRaw ? new Date(modifyRaw) : null;

  return {
    id: Number(row.id ?? 0),
    uuid,
    phone,
    name: unwrapField(row.name) ?? unwrapField(fields.name) ?? unwrapField(fields.full_name),
    unit: unwrapField(fields.unit_number) ?? unwrapField(fields.main_unit_no),
    building: unwrapField(fields.building_name),
    totalDue: unwrapNumber(fields.total_due) ?? unwrapNumber(fields.arrears_amount),
    ptpConfirmed: unwrapBoolean(fields.ptp_confirmed),
    ptpAmount: unwrapNumber(fields.ptp_amount),
    disputed: unwrapBoolean(fields.dispute_raised) || unwrapBoolean(fields.disputed),
    paidClaimed: unwrapBoolean(fields.paid_already) || unwrapBoolean(fields.paid_claimed),
    escalated: unwrapBoolean(fields.escalation_flag) || unwrapBoolean(fields.escalate),
    doNotCall: unwrapBoolean(fields.dnc_flag) || unwrapBoolean(fields.do_not_contact),
    // The batch column first: the flow may clear `call` when a call completes,
    // so attribution cannot depend on it. `call` stays as the fallback for
    // records stamped before the batch column was used.
    wrongPerson: unwrapBoolean(fields.wrong_person),
    callBatch: unwrapField(fields.batch) ?? unwrapField(fields.call),
    callFlag: unwrapField(fields.call),
    modifiedAt: modifiedAt && !Number.isNaN(modifiedAt.getTime()) ? modifiedAt : null,
    raw: fields,
  };
}

/**
 * Pull customers, then apply the two corrections that matter:
 *
 *  1. staleness — a customer record holds the LAST outcome ever written, from
 *     any campaign, so records not touched since the campaign started are
 *     dropped;
 *  2. duplicates — the same phone appears many times, so the most recently
 *     modified record wins.
 *
 * Skipping either inflates every count (5,608 "records" for 660 phones in
 * testing).
 */
export async function pullCustomers(
  client: JobixClient,
  options: {
    campaignStart?: Date;
    maxPages?: number;
    /** Return false to stop paging (used to stay inside a run budget). */
    onPage?: (info: { page: number; pulled: number }) => void | boolean | Promise<void | boolean>;
  } = {},
): Promise<{ customers: JobixCustomer[]; rawCount: number; droppedStale: number; droppedDuplicate: number }> {
  const all: JobixCustomer[] = [];
  const maxPages = options.maxPages ?? 200;

  for (let page = 1; page <= maxPages; page++) {
    const payload = await client.get<{ data?: Record<string, unknown>[]; meta?: PagedMeta }>("/api/customers", {
      page,
      page_size: CUSTOMERS_MAX_PAGE_SIZE, // 100 is fine on this endpoint
    });
    const rows = payload.data ?? [];
    if (rows.length === 0) break;
    all.push(...rows.map(toCustomer).filter((c): c is JobixCustomer => c !== null));
    if ((await options.onPage?.({ page, pulled: all.length })) === false) break;
    if (payload.meta && !payload.meta.hasNextPage) break;
  }

  const rawCount = all.length;

  const fresh = options.campaignStart
    ? all.filter((c) => c.modifiedAt !== null && c.modifiedAt >= options.campaignStart!)
    : all;
  const droppedStale = rawCount - fresh.length;

  const byPhone = new Map<string, JobixCustomer>();
  for (const customer of fresh) {
    const key = customer.phone.replace(/[^\d+]/g, "");
    const existing = byPhone.get(key);
    if (
      !existing ||
      (customer.modifiedAt?.getTime() ?? 0) > (existing.modifiedAt?.getTime() ?? 0)
    ) {
      byPhone.set(key, customer);
    }
  }
  const customers = [...byPhone.values()];

  return {
    customers,
    rawCount,
    droppedStale,
    droppedDuplicate: fresh.length - customers.length,
  };
}

// --- flows and node execution history --------------------------------------

export const NODE_STATUS_SUCCESS = 13;
export const NODE_STATUS_FAILED = 98;

export type JobixNodeEvent = {
  companyNodeId: number;
  status: number;
  succeeded: boolean;
  failed: boolean;
  /** For filter nodes: "_0" = matched/Yes, "_1" = not matched. */
  outputSocketId: string | null;
  matchedFilter: boolean | null;
  customerName: string | null;
  createdAt: Date;
};

export type JobixFlowNode = {
  companyNodeId: number;
  name: string | null;
  number: number | null;
  /** The node's own uuid, which is what the trigger request names. Null when
   *  this flow's node list does not carry one — the value then has to come
   *  from a capture of the builder's Run button. */
  uuid: string | null;
  /** The node's kind where the payload says so ("event", "filter", "call"…),
   *  which is how the entry node is recognised without opening the builder. */
  kind: string | null;
};

export async function fetchFlowNodes(client: JobixClient, flowUuid: string): Promise<JobixFlowNode[]> {
  const payload = await client.get<{ data?: Record<string, unknown>[] }>(`/api/flows/${flowUuid}/nodes`);
  return (payload.data ?? []).map((row) => ({
    companyNodeId: Number(row.company_node_id ?? row.id ?? 0),
    name: row.name ? String(row.name) : null,
    number: row.number === undefined || row.number === null ? null : Number(row.number),
    uuid: firstString(row.uuid, row.node_uuid, row.company_node_uuid),
    kind: firstString(row.type, row.node_type, row.kind),
  }));
}

function firstString(...candidates: unknown[]): string | null {
  for (const candidate of candidates) {
    if (typeof candidate === "string" && candidate.trim() !== "") return candidate.trim();
    if (typeof candidate === "number") return String(candidate);
  }
  return null;
}

/**
 * Pull node execution history.
 *
 * The node_ids filter is broken (it returned 8 records for a node with 60+),
 * so pages are pulled unfiltered and filtered here.
 */
export async function pullNodeHistory(
  client: JobixClient,
  flowUuid: string,
  options: { companyNodeIds?: number[]; since?: Date; maxPages?: number } = {},
): Promise<JobixNodeEvent[]> {
  const wanted = options.companyNodeIds ? new Set(options.companyNodeIds) : null;
  const events: JobixNodeEvent[] = [];
  const maxPages = options.maxPages ?? 100;

  for (let page = 1; page <= maxPages; page++) {
    const payload = await client.get<{ data?: Record<string, unknown>[]; meta?: PagedMeta }>(
      `/api/flows/${flowUuid}/node-history`,
      { page, page_size: 100 }, // deliberately NOT node_ids — that filter is broken
    );
    const rows = payload.data ?? [];
    if (rows.length === 0) break;

    for (const row of rows) {
      const companyNodeId = Number(row.company_node_id ?? 0);
      if (wanted && !wanted.has(companyNodeId)) continue;
      const createdAt = new Date(String(row.created_at ?? Date.now()));
      if (options.since && createdAt < options.since) continue;
      const status = Number(row.status ?? 0);
      const socket = row.output_socket_id ? String(row.output_socket_id) : null;
      events.push({
        companyNodeId,
        status,
        succeeded: status === NODE_STATUS_SUCCESS,
        failed: status === NODE_STATUS_FAILED,
        outputSocketId: socket,
        matchedFilter: socket ? socket.endsWith("_0") : null,
        customerName: row.customer_name ? String(row.customer_name) : null,
        createdAt,
      });
    }
    if (payload.meta && !payload.meta.hasNextPage) break;
  }
  return events;
}

// --- workspace health check -------------------------------------------------

export type WorkspaceHealth = {
  ok: boolean;
  agentNames: string[];
  conversationTotal: number | null;
  message: string;
};

/**
 * Assert the token points at the expected workspace.
 *
 * Every response is scoped to the token's workspace, and the same endpoints
 * will happily return a plausible dataset from the wrong one. Ingestion must
 * refuse to run unless the expected agents are present.
 */
export async function checkWorkspace(
  client: JobixClient,
  expectedAgentNames: string[] = [],
): Promise<WorkspaceHealth> {
  const agentsPayload = await client.get<{ data?: Record<string, unknown>[] }>("/api/agents", {
    page: 1,
    page_size: 50,
  });
  const agentNames = (agentsPayload.data ?? [])
    .map((row) => (row.name ? String(row.name) : null))
    .filter((n): n is string => n !== null);

  const convPayload = await client.get<{ meta?: PagedMeta }>("/api/conversations", {
    page: 1,
    page_size: CONVERSATIONS_MAX_PAGE_SIZE,
  });
  const conversationTotal = convPayload.meta?.totalCount ?? null;

  if (expectedAgentNames.length === 0) {
    return {
      ok: true,
      agentNames,
      conversationTotal,
      message: `Connected. Agents: ${agentNames.slice(0, 4).join(", ") || "none"}.`,
    };
  }

  const missing = expectedAgentNames.filter(
    (expected) => !agentNames.some((name) => name.toLowerCase().includes(expected.toLowerCase())),
  );
  if (missing.length > 0) {
    return {
      ok: false,
      agentNames,
      conversationTotal,
      message: `Wrong workspace: expected agent(s) ${missing.join(", ")} not found. Found: ${agentNames.slice(0, 6).join(", ") || "none"}. Switch workspace before ingesting.`,
    };
  }
  return {
    ok: true,
    agentNames,
    conversationTotal,
    message: `Workspace confirmed (${agentNames.length} agents, ${conversationTotal ?? "?"} conversations).`,
  };
}

/** Throwing variant used to gate ingestion. */
export async function requireWorkspace(client: JobixClient, expectedAgentNames: string[]): Promise<WorkspaceHealth> {
  const health = await checkWorkspace(client, expectedAgentNames);
  if (!health.ok) throw new JobixError(health.message, "workspace_mismatch");
  return health;
}
