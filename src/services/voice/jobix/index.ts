import {
  ProviderError,
  UnsupportedCapabilityError,
  type CreateCampaignInput,
  type ProviderAgent,
  type ProviderCall,
  type ProviderCampaignRef,
  type ProviderCapability,
  type ProviderContact,
  type VoiceCampaignProvider,
} from "../types";
import { JobixClient, type JobixConfig } from "./client";
import { mapOutcome, mapStatus, pick, toDate } from "./mapping";

// ---------------------------------------------------------------------------
// Jobix provider.
//
// Endpoint paths come from per-organization configuration
// (IntegrationSettings.endpoints) — none are hard-coded here, because guessing
// a path produces a silent failure at the worst possible moment. A capability
// is offered only when its endpoint is configured; otherwise the control layer
// gets UnsupportedCapabilityError and tells the operator exactly what is
// missing.
//
// Known-good read paths on the Jobix dashboard API (observed in production
// use): `/agents` and `/conversations`, both paged with `page` and `page_size`.
// Configure them as `listAgents` and `listCalls` to enable result sync.
//
// Write capabilities (create/start/pause/stop a campaign, upload contacts) are
// only used when their paths are configured. If your Jobix plan drives dialling
// from the dashboard instead of an API, leave them unset and use the manual
// provider's paste flow — results still sync back through `listCalls`.
// ---------------------------------------------------------------------------

const CAPABILITY_ENDPOINTS: Record<Exclude<ProviderCapability, "webhooks">, string> = {
  listAgents: "listAgents",
  listCalls: "listCalls",
  getCall: "getCall",
  createCampaign: "createCampaign",
  addContacts: "addContacts",
  startCampaign: "startCampaign",
  pauseCampaign: "pauseCampaign",
  stopCampaign: "stopCampaign",
  getCampaign: "getCampaign",
};

type JobixRecord = Record<string, unknown>;

export class JobixProvider implements VoiceCampaignProvider {
  readonly name = "jobix" as const;
  readonly capabilities: ReadonlySet<ProviderCapability>;
  private client: JobixClient;

  constructor(
    config: JobixConfig,
    private outcomeOverrides: Record<string, string> = {},
    webhooksConfigured = false,
  ) {
    this.client = new JobixClient(config);
    const available = new Set<ProviderCapability>();
    for (const [capability, key] of Object.entries(CAPABILITY_ENDPOINTS)) {
      if (config.endpoints[key]) available.add(capability as ProviderCapability);
    }
    if (webhooksConfigured) available.add("webhooks");
    this.capabilities = available;
  }

  private require(capability: ProviderCapability) {
    if (!this.capabilities.has(capability)) {
      throw new UnsupportedCapabilityError("Jobix", capability);
    }
  }

  /** Unwrap the `{ data: [...] }` envelope the Jobix API uses. */
  private rows(payload: unknown): JobixRecord[] {
    if (Array.isArray(payload)) return payload as JobixRecord[];
    if (payload && typeof payload === "object") {
      const data = (payload as JobixRecord).data ?? (payload as JobixRecord).results;
      if (Array.isArray(data)) return data as JobixRecord[];
    }
    return [];
  }

  async listAgents(): Promise<ProviderAgent[]> {
    this.require("listAgents");
    const payload = await this.client.request<unknown>("listAgents", {
      query: { page: 0, page_size: 100 },
    });
    const agents: ProviderAgent[] = [];
    for (const row of this.rows(payload)) {
      const externalId = pick<string>(row, ["uuid", "id", "agent_id"]);
      const name = pick<string>(row, ["name", "title"]);
      if (!externalId || !name) continue;
      agents.push({
        externalId: String(externalId),
        name: String(name),
        status: pick<string>(row, ["status"]) ?? null,
      });
    }
    return agents;
  }

  /** Normalise one provider call record. */
  private toCall(row: JobixRecord): ProviderCall | null {
    const providerCallId = pick<string>(row, ["uuid", "id", "call_id", "conversation_id"]);
    const phone = pick<string>(row, ["phone_number", "phone", "to", "destination"]);
    if (!providerCallId || !phone) return null;

    const startedAt =
      toDate(pick(row, ["started_at", "created_at", "start_time", "timestamp"])) ?? new Date();
    const durationRaw = pick<number | string>(row, ["duration", "duration_seconds", "talk_time"]);
    const durationSeconds = Math.max(0, Math.round(Number(durationRaw ?? 0)) || 0);
    const rawStatus = pick<string>(row, ["status", "call_status", "disposition", "state"]) ?? null;
    const rawOutcome =
      pick<string>(row, ["outcome", "result", "call_outcome", "calloutcome_tag", "outcome_category"]) ?? null;

    const agent = row.agent as JobixRecord | undefined;

    return {
      providerCallId: String(providerCallId),
      providerCampaignId:
        (pick<string>(row, ["campaign_id", "batch_id", "campaign"]) as string | undefined) ?? null,
      reference: (pick<string>(row, ["reference", "external_id", "client_reference"]) as string | undefined) ?? null,
      phone: String(phone),
      agentName: agent ? (pick<string>(agent, ["name"]) ?? null) : (pick<string>(row, ["agent_name"]) ?? null),
      startedAt,
      endedAt: toDate(pick(row, ["ended_at", "end_time", "completed_at"])),
      durationSeconds,
      rawStatus,
      // A connected call with talk time is "completed" even when the provider
      // labels it loosely; zero-duration calls are never treated as answered.
      status: durationSeconds > 0 ? mapStatus(rawStatus ?? "completed", this.outcomeOverrides) : mapStatus(rawStatus ?? "no_answer", this.outcomeOverrides),
      outcome: mapOutcome(rawOutcome, this.outcomeOverrides),
      transcript: (pick<string>(row, ["transcript", "transcription", "conversation"]) as string | undefined) ?? null,
      recordingUrl: (pick<string>(row, ["recording_url", "recording", "audio_url"]) as string | undefined) ?? null,
    };
  }

  async listCalls(options: { since?: Date; providerCampaignId?: string; limit?: number } = {}): Promise<ProviderCall[]> {
    this.require("listCalls");
    const pageSize = Math.min(50, options.limit ?? 50);
    const collected: ProviderCall[] = [];
    // Pages are newest-first; stop as soon as a page falls entirely before
    // `since` so a sync never walks the whole history.
    for (let page = 0; page < 40; page++) {
      const payload = await this.client.request<unknown>("listCalls", {
        query: {
          page,
          page_size: pageSize,
          ...(options.providerCampaignId ? { campaign_id: options.providerCampaignId } : {}),
        },
      });
      const rows = this.rows(payload);
      if (rows.length === 0) break;
      let reachedFloor = false;
      for (const row of rows) {
        const call = this.toCall(row);
        if (!call) continue;
        if (options.since && call.startedAt <= options.since) {
          reachedFloor = true;
          continue;
        }
        collected.push(call);
        if (options.limit && collected.length >= options.limit) return collected;
      }
      if (reachedFloor) break;
    }
    return collected;
  }

  async getCall(providerCallId: string): Promise<ProviderCall | null> {
    this.require("getCall");
    const payload = await this.client.request<unknown>("getCall", { suffix: `/${providerCallId}` });
    const row = (payload && typeof payload === "object" && "data" in (payload as JobixRecord)
      ? (payload as JobixRecord).data
      : payload) as JobixRecord | undefined;
    return row ? this.toCall(row) : null;
  }

  async createCampaign(input: CreateCampaignInput): Promise<ProviderCampaignRef> {
    this.require("createCampaign");
    const payload = await this.client.request<JobixRecord>("createCampaign", {
      method: "POST",
      idempotencyKey: input.idempotencyKey,
      body: {
        name: input.name,
        agent_id: input.agentExternalId,
        calling_hours_start: input.callingHoursStart,
        calling_hours_end: input.callingHoursEnd,
        max_attempts: input.maxAttempts,
        retry_interval_hours: input.retryIntervalHours,
        timezone: input.timezone,
      },
    });
    const id = pick<string>(payload, ["uuid", "id", "campaign_id"]);
    if (!id) {
      throw new ProviderError(
        "Jobix accepted the campaign but returned no campaign id.",
        "invalid_response",
      );
    }
    return { providerCampaignId: String(id), status: String(pick(payload, ["status"]) ?? "created") };
  }

  async addContacts(providerCampaignId: string, contacts: ProviderContact[]): Promise<{ accepted: number }> {
    this.require("addContacts");
    // Chunked so a large book never exceeds a request limit.
    const CHUNK = 200;
    let accepted = 0;
    for (let i = 0; i < contacts.length; i += CHUNK) {
      const chunk = contacts.slice(i, i + CHUNK);
      const payload = await this.client.request<JobixRecord>("addContacts", {
        method: "POST",
        idempotencyKey: `${providerCampaignId}:contacts:${i}`,
        body: {
          campaign_id: providerCampaignId,
          contacts: chunk.map((c) => ({
            reference: c.reference,
            name: c.name,
            phone: c.phone,
            email: c.email ?? undefined,
            tenant_code: c.accountNumber,
            total_due: c.amountDue,
            arrears_amount: c.amountDue,
            building_name: c.creditorName ?? undefined,
            ...(c.metadata ?? {}),
          })),
        },
      });
      const count = Number(pick(payload, ["accepted", "count", "created"]) ?? chunk.length);
      accepted += Number.isFinite(count) ? count : chunk.length;
    }
    return { accepted };
  }

  private async lifecycle(
    capability: Extract<ProviderCapability, "startCampaign" | "pauseCampaign" | "stopCampaign" | "getCampaign">,
    providerCampaignId: string,
  ): Promise<ProviderCampaignRef> {
    this.require(capability);
    const payload = await this.client.request<JobixRecord>(capability, {
      method: capability === "getCampaign" ? "GET" : "POST",
      suffix: `/${providerCampaignId}`,
      idempotencyKey: capability === "getCampaign" ? undefined : `${providerCampaignId}:${capability}`,
    });
    return {
      providerCampaignId,
      status: String(pick(payload, ["status", "state"]) ?? "unknown"),
    };
  }

  startCampaign(id: string) {
    return this.lifecycle("startCampaign", id);
  }
  pauseCampaign(id: string) {
    return this.lifecycle("pauseCampaign", id);
  }
  stopCampaign(id: string) {
    return this.lifecycle("stopCampaign", id);
  }
  getCampaign(id: string) {
    return this.lifecycle("getCampaign", id);
  }
}
