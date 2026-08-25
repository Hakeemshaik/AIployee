import {
  UnsupportedCapabilityError,
  type CreateCampaignInput,
  type ProviderAgent,
  type ProviderCall,
  type ProviderCampaignRef,
  type ProviderCapability,
  type ProviderContact,
  type VoiceCampaignProvider,
} from "./types";

// ---------------------------------------------------------------------------
// Manual provider — the paste workflow, modelled honestly.
//
// Used when the voice platform is driven from its own dashboard rather than an
// API. Campaign "creation" produces a local batch reference and tells the
// operator the one step they must perform (paste the dialling list); results
// still flow back through the webhook receiver.
//
// It deliberately does NOT implement start/pause/stop: those actions cannot be
// performed from here, and reporting them as done would be a lie. The control
// layer surfaces the manual step instead.
// ---------------------------------------------------------------------------

export class ManualProvider implements VoiceCampaignProvider {
  readonly name = "manual" as const;
  readonly capabilities: ReadonlySet<ProviderCapability> = new Set<ProviderCapability>([
    "createCampaign",
    "addContacts",
    "webhooks",
  ]);

  async listAgents(): Promise<ProviderAgent[]> {
    return [];
  }

  async createCampaign(input: CreateCampaignInput): Promise<ProviderCampaignRef> {
    return {
      providerCampaignId: `manual:${input.idempotencyKey}`,
      status: "awaiting_operator",
      manualStep:
        "Copy the dialling list (Build Jobix list) and paste it into the voice platform's Database import, then start the run there.",
    };
  }

  async addContacts(_providerCampaignId: string, contacts: ProviderContact[]) {
    // The list is handed over by the operator; nothing is transmitted here.
    return { accepted: contacts.length };
  }

  async startCampaign(): Promise<ProviderCampaignRef> {
    throw new UnsupportedCapabilityError("manual", "startCampaign");
  }
  async pauseCampaign(): Promise<ProviderCampaignRef> {
    throw new UnsupportedCapabilityError("manual", "pauseCampaign");
  }
  async stopCampaign(): Promise<ProviderCampaignRef> {
    throw new UnsupportedCapabilityError("manual", "stopCampaign");
  }
  async getCampaign(providerCampaignId: string): Promise<ProviderCampaignRef> {
    return { providerCampaignId, status: "awaiting_operator" };
  }
  async getCall(): Promise<ProviderCall | null> {
    return null;
  }
  async listCalls(): Promise<ProviderCall[]> {
    return [];
  }
}
