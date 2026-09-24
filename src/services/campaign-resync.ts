import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { UNREACHED_OUTCOMES, type RedialFilter } from "@/lib/domain";
import { getVoiceProvider, ProviderError, type ProviderCall } from "@/services/voice";
import { processCallCompleted } from "@/services/integrations/voice";
import { redialCounts } from "@/services/redial";

// ---------------------------------------------------------------------------
// Resync.
//
// Webhooks are the fast path, but they are not a guarantee: a delivery can be
// missed while a deploy is mid-flight, or the provider plan may not send them
// at all. Resync pulls the calls back from the provider and puts them through
// exactly the same ingestion as a webhook, so who picked up and who did not is
// correct before anyone is redialled.
//
// Ingestion is idempotent on the provider's call id, so resyncing twice — or
// resyncing over calls a webhook already delivered — changes nothing.
// ---------------------------------------------------------------------------

/** Re-read a little before the last sync; provider clocks and ours disagree. */
const OVERLAP_MS = 60 * 60_000;

export type ResyncResult = {
  /** Calls returned by the provider across every batch of this campaign. */
  fetched: number;
  /** Calls that were new to us and have now been stored and analysed. */
  ingested: number;
  /** Calls we already had — expected, and not a problem. */
  duplicates: number;
  failed: number;
  /** Provider campaigns/batches that were polled. */
  batches: number;
  /** Contacts whose latest attempt did not reach anyone. */
  notReached: number;
  /** How many contacts each redial button would now dial. */
  redial: Record<RedialFilter, number>;
  syncedAt: string;
};

function toPayload(call: ProviderCall, campaignId: string) {
  return {
    externalCallId: call.providerCallId,
    phone: call.phone,
    campaignId,
    direction: "outbound" as const,
    startedAt: call.startedAt,
    endedAt: call.endedAt ?? undefined,
    durationSeconds: call.durationSeconds,
    status: call.status,
    transcript: call.transcript ?? undefined,
    recordingUrl: call.recordingUrl ?? undefined,
    outcome: call.outcome ?? undefined,
    providerBatchId: call.providerCampaignId ?? undefined,
  };
}

export async function resyncCampaign(
  organizationId: string,
  userId: string,
  campaignId: string,
): Promise<ResyncResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      id: true,
      providerCampaignId: true,
      providerStartedAt: true,
      createdAt: true,
      maxAttempts: true,
    },
  });
  if (!campaign) throw new Error("Campaign not found");

  const { provider } = await getVoiceProvider(organizationId);
  if (!provider.capabilities.has("listCalls")) {
    throw new ProviderError(
      `The ${provider.name} integration cannot read call results back. Point the provider's webhook at this platform, or set the listCalls endpoint in Settings → Integration.`,
      "unsupported",
      "listCalls",
    );
  }

  const batches = await db.redialBatch.findMany({
    where: { organizationId, campaignId, providerCampaignId: { not: null } },
    select: { providerCampaignId: true },
  });

  // Each batch is its own provider campaign, plus whatever the campaign itself
  // was started as before batching.
  const providerIds = Array.from(
    new Set(
      [campaign.providerCampaignId, ...batches.map((b) => b.providerCampaignId)].filter(
        (v): v is string => typeof v === "string" && v !== "",
      ),
    ),
  );
  if (providerIds.length === 0) {
    throw new ProviderError(
      "This campaign has not been run yet, so there is nothing to sync.",
      "rejected",
    );
  }

  const settings = await db.integrationSettings.findUnique({ where: { organizationId } });
  const floor = settings?.lastSyncAt ?? campaign.providerStartedAt ?? campaign.createdAt;
  const since = new Date(floor.getTime() - OVERLAP_MS);

  const seen = new Set<string>();
  const calls: ProviderCall[] = [];
  for (const providerCampaignId of providerIds) {
    const page = await provider.listCalls({ since, providerCampaignId });
    for (const call of page) {
      if (seen.has(call.providerCallId)) continue;
      seen.add(call.providerCallId);
      calls.push(call);
    }
  }

  let ingested = 0;
  let duplicates = 0;
  let failed = 0;

  // Sequential: ingestion writes calls, analyses, promises and campaign
  // metrics, and two results for the same debtor must not interleave.
  for (const call of calls) {
    try {
      const result = await processCallCompleted(
        organizationId,
        `resync:${userId}`,
        toPayload(call, campaignId),
      );
      if ("duplicate" in result && result.duplicate) duplicates++;
      else ingested++;
    } catch (err) {
      failed++;
      console.error(`[resync] failed to ingest ${call.providerCallId}:`, err);
    }
  }

  const syncedAt = new Date();
  if (settings) {
    await db.integrationSettings.update({
      where: { organizationId },
      data: { lastSyncAt: syncedAt, lastSyncError: failed > 0 ? `${failed} call(s) failed to ingest` : null },
    });
  }

  const [notReached, redial] = await Promise.all([
    db.campaignContact.count({
      where: { organizationId, campaignId, lastOutcome: { in: [...UNREACHED_OUTCOMES] } },
    }),
    redialCounts(organizationId, campaignId, campaign.maxAttempts),
  ]);

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.resynced",
    entityType: "campaign",
    entityId: campaignId,
    detail: { fetched: calls.length, ingested, duplicates, failed, batches: providerIds.length },
  });

  return {
    fetched: calls.length,
    ingested,
    duplicates,
    failed,
    batches: providerIds.length,
    notReached,
    redial,
    syncedAt: syncedAt.toISOString(),
  };
}
