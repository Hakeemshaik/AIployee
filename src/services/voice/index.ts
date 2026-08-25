import { db } from "@/lib/db";
import { JobixProvider } from "./jobix";
import { loadJobixEnv } from "./jobix/client";
import { ManualProvider } from "./manual";
import type { VoiceCampaignProvider } from "./types";

export * from "./types";

// ---------------------------------------------------------------------------
// Provider factory.
//
// Resolution order:
//   1. per-organization IntegrationSettings (provider, baseUrl, endpoints)
//   2. JOBIX_* environment variables
//   3. the manual paste workflow
//
// Credentials only ever come from the environment — never from the database
// and never from the client.
// ---------------------------------------------------------------------------

export type ResolvedProvider = {
  provider: VoiceCampaignProvider;
  /** Why this provider was chosen, shown in Settings. */
  reason: string;
  configured: boolean;
};

export async function getVoiceProvider(organizationId: string): Promise<ResolvedProvider> {
  const settings = await db.integrationSettings.findUnique({ where: { organizationId } });
  const env = loadJobixEnv();

  const wantsJobix = settings?.provider === "jobix" || (!settings && !!env.apiKey);
  if (wantsJobix) {
    const baseUrl = settings?.baseUrl || env.baseUrl;
    if (!baseUrl || !env.apiKey) {
      return {
        provider: new ManualProvider(),
        reason: !env.apiKey
          ? "Jobix selected but JOBIX_API_KEY is not set on the server — falling back to the paste workflow."
          : "Jobix selected but no base URL is configured — falling back to the paste workflow.",
        configured: false,
      };
    }
    let endpoints: Record<string, string> = {};
    let outcomeMap: Record<string, string> = {};
    try {
      endpoints = settings?.endpoints ? JSON.parse(settings.endpoints) : {};
      outcomeMap = settings?.outcomeMap ? JSON.parse(settings.outcomeMap) : {};
    } catch {
      endpoints = {};
    }
    return {
      provider: new JobixProvider({ baseUrl, apiKey: env.apiKey, endpoints }, outcomeMap, !!env.webhookSecret),
      reason: `Jobix at ${baseUrl} with ${Object.keys(endpoints).length} configured endpoint(s).`,
      configured: Object.keys(endpoints).length > 0,
    };
  }

  return {
    provider: new ManualProvider(),
    reason: "Manual paste workflow: dialling lists are exported and pasted into the voice platform; results return via the webhook.",
    configured: true,
  };
}
