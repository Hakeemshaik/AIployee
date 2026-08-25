import type { CallOutcome } from "@/lib/domain";

// ---------------------------------------------------------------------------
// Voice campaign provider abstraction.
//
// The platform is the control centre; a provider executes the calls. Nothing
// outside src/services/voice knows which provider is in use — pages and
// services talk to this interface only, so a second provider can be added
// without touching campaign logic.
//
// Capabilities differ per provider and per plan, so a provider declares what
// it supports. The control layer checks `capabilities` before offering an
// action and surfaces a precise "not supported" error instead of pretending.
// ---------------------------------------------------------------------------

export type ProviderCapability =
  | "createCampaign"
  | "addContacts"
  | "startCampaign"
  | "pauseCampaign"
  | "stopCampaign"
  | "getCampaign"
  | "getCall"
  | "listCalls"
  | "listAgents"
  | "webhooks";

/** One contact handed to the provider for dialling. */
export type ProviderContact = {
  /** Our CampaignContact id — echoed back by the provider where supported. */
  reference: string;
  name: string;
  phone: string; // E.164
  email?: string | null;
  accountNumber: string;
  amountDue: number;
  creditorName?: string | null;
  /** Extra fields the agent prompt reads. */
  metadata?: Record<string, string | number | null>;
};

export type CreateCampaignInput = {
  name: string;
  /** Provider-side agent/flow id (AIAgent.externalId). */
  agentExternalId: string | null;
  callingHoursStart: string;
  callingHoursEnd: string;
  maxAttempts: number;
  retryIntervalHours: number;
  timezone: string;
  /** Stable key so a retried start never creates a second provider campaign. */
  idempotencyKey: string;
};

export type ProviderCampaignRef = {
  providerCampaignId: string;
  status: string;
  /** Set when the provider cannot be driven by API and needs an operator step. */
  manualStep?: string;
};

/** A call as reported by the provider, already normalised. */
export type ProviderCall = {
  providerCallId: string;
  providerCampaignId?: string | null;
  /** Our CampaignContact reference when the provider echoes it back. */
  reference?: string | null;
  phone: string;
  agentName?: string | null;
  startedAt: Date;
  endedAt?: Date | null;
  durationSeconds: number;
  /** Provider's own status/result string, kept for auditing. */
  rawStatus?: string | null;
  status: "completed" | "no_answer" | "busy" | "voicemail" | "failed";
  outcome?: CallOutcome | null;
  transcript?: string | null;
  recordingUrl?: string | null;
};

export type ProviderAgent = {
  externalId: string;
  name: string;
  status?: string | null;
};

export interface VoiceCampaignProvider {
  readonly name: "manual" | "jobix";
  readonly capabilities: ReadonlySet<ProviderCapability>;

  listAgents(): Promise<ProviderAgent[]>;
  createCampaign(input: CreateCampaignInput): Promise<ProviderCampaignRef>;
  addContacts(providerCampaignId: string, contacts: ProviderContact[]): Promise<{ accepted: number }>;
  startCampaign(providerCampaignId: string): Promise<ProviderCampaignRef>;
  pauseCampaign(providerCampaignId: string): Promise<ProviderCampaignRef>;
  stopCampaign(providerCampaignId: string): Promise<ProviderCampaignRef>;
  getCampaign(providerCampaignId: string): Promise<ProviderCampaignRef>;
  getCall(providerCallId: string): Promise<ProviderCall | null>;
  /** Pull calls newer than `since` — the polling path when webhooks are absent. */
  listCalls(options: { since?: Date; providerCampaignId?: string; limit?: number }): Promise<ProviderCall[]>;
}

// --- errors -----------------------------------------------------------------

/** Base class for every provider failure surfaced to the operator. */
export class ProviderError extends Error {
  constructor(
    message: string,
    readonly code:
      | "not_configured"
      | "unsupported"
      | "unauthorized"
      | "unavailable"
      | "rejected"
      | "not_found"
      | "invalid_response",
    readonly detail?: string,
  ) {
    super(message);
    this.name = "ProviderError";
  }
}

export class UnsupportedCapabilityError extends ProviderError {
  constructor(provider: string, capability: ProviderCapability) {
    super(
      `The ${provider} integration does not expose "${capability}". Configure the endpoint in Settings → Integration, or run this step in the provider dashboard.`,
      "unsupported",
      capability,
    );
  }
}
