import { createHash } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { label, type RedialFilter } from "@/lib/domain";
import { getVoiceProvider, ProviderError } from "@/services/voice";
import { eligibleContacts, toProviderContacts } from "@/services/campaign-control";

// ---------------------------------------------------------------------------
// Redial engine.
//
// One reusable function powers every redial button (no answers, busy numbers,
// failed calls, callbacks due). The guarantee it exists to provide:
//
//   a redial batch contains ONLY the contacts matching its filter —
//   never the whole campaign.
//
// Filters are applied to per-campaign contact state (CampaignContact), so
// attempt counts and outcomes are campaign-specific, and the retry ceiling is
// enforced before anything is handed to the provider.
// ---------------------------------------------------------------------------

/** Which stored outcomes each filter targets. */
const FILTER_OUTCOMES: Record<RedialFilter, string[]> = {
  no_answer: ["no_answer", "voicemail"],
  busy: ["busy"],
  failed: ["failed"],
  callback_due: ["callback_requested"],
};

export type RedialPreview = {
  filter: RedialFilter;
  eligible: number;
  matched: number;
  blockedByRetryLimit: number;
  blockedBySuppression: number;
};

export type RedialResult = {
  batchId: string;
  filter: RedialFilter;
  contactCount: number;
  providerCampaignId: string | null;
  provider: string;
  manualStep?: string;
};

/**
 * Select the contacts a filter targets, with every exclusion applied.
 * Shared by the preview counts and the batch creation so the number on the
 * button is exactly the number that gets dialled.
 */
async function selectContacts(
  organizationId: string,
  campaignId: string,
  filter: RedialFilter,
  maxRetries: number,
) {
  // eligibleContacts already removes suppressed debtors, bad numbers, settled
  // balances and inactive contacts — deliberately without the retry cap, so
  // the two exclusion reasons can be reported separately.
  const dialable = await eligibleContacts(organizationId, campaignId);
  const outcomes = FILTER_OUTCOMES[filter];
  const now = new Date();

  const matched = dialable.filter((c) => {
    if (!c.lastOutcome || !outcomes.includes(c.lastOutcome)) return false;
    // A callback is only due once its requested time has passed.
    if (filter === "callback_due" && c.callbackAt && c.callbackAt > now) return false;
    return true;
  });
  const selected = matched.filter((c) => c.attempts < maxRetries);

  const allInCampaign = await db.campaignContact.count({ where: { organizationId, campaignId } });
  return {
    selected,
    matched: matched.length,
    blockedByRetryLimit: matched.length - selected.length,
    blockedBySuppression: allInCampaign - dialable.length,
    eligible: dialable.length,
  };
}

export async function previewRedial(
  organizationId: string,
  campaignId: string,
  filter: RedialFilter,
  maxRetries: number,
): Promise<RedialPreview> {
  const r = await selectContacts(organizationId, campaignId, filter, maxRetries);
  return {
    filter,
    eligible: r.eligible,
    matched: r.selected.length,
    blockedByRetryLimit: r.blockedByRetryLimit,
    blockedBySuppression: r.blockedBySuppression,
  };
}

/** Counts for every redial button in one query pass. */
export async function redialCounts(
  organizationId: string,
  campaignId: string,
  maxRetries: number,
): Promise<Record<RedialFilter, number>> {
  const entries = await Promise.all(
    (Object.keys(FILTER_OUTCOMES) as RedialFilter[]).map(
      async (filter) =>
        [filter, (await selectContacts(organizationId, campaignId, filter, maxRetries)).selected.length] as const,
    ),
  );
  return Object.fromEntries(entries) as Record<RedialFilter, number>;
}

export async function createRedialBatch({
  organizationId,
  userId,
  campaignId,
  filter,
  maxRetries,
}: {
  organizationId: string;
  userId: string;
  campaignId: string;
  filter: RedialFilter;
  maxRetries?: number;
}): Promise<RedialResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { agent: true, organization: { select: { timezone: true } } },
  });
  if (!campaign) throw new Error("Campaign not found");

  const retryCeiling = maxRetries ?? campaign.maxAttempts;
  const { selected } = await selectContacts(organizationId, campaignId, filter, retryCeiling);

  if (selected.length === 0) {
    throw new ProviderError(
      `No contacts match "${label(filter)}" that are still within the ${retryCeiling}-attempt limit.`,
      "rejected",
    );
  }

  // Idempotency: the same filter over the same contact set is one batch, so a
  // double-clicked button cannot dial anyone twice.
  const key = `${campaignId}:${filter}:${createHash("sha256")
    .update(selected.map((c) => `${c.id}:${c.attempts}`).sort().join(","))
    .digest("hex")
    .slice(0, 16)}`;

  const existing = await db.redialBatch.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return {
      batchId: existing.id,
      filter,
      contactCount: existing.contactCount,
      providerCampaignId: existing.providerCampaignId,
      provider: "existing batch (idempotent replay)",
    };
  }

  const batch = await db.redialBatch.create({
    data: {
      organizationId,
      campaignId,
      filter,
      contactCount: selected.length,
      maxRetries: retryCeiling,
      status: "queued",
      idempotencyKey: key,
      createdByUserId: userId,
    },
  });

  const { provider, reason } = await getVoiceProvider(organizationId);
  try {
    const providerCampaignId = (
      await provider.createCampaign({
        name: `${campaign.name} — ${label(filter)} redial`,
        agentExternalId: campaign.agent?.externalId ?? null,
        callingHoursStart: campaign.callingHoursStart,
        callingHoursEnd: campaign.callingHoursEnd,
        maxAttempts: retryCeiling,
        retryIntervalHours: campaign.retryIntervalHours,
        timezone: campaign.organization.timezone,
        idempotencyKey: key,
      })
    ).providerCampaignId;

    // ONLY the filtered contacts are sent.
    await provider.addContacts(providerCampaignId, toProviderContacts(selected));

    let status = "queued";
    let manualStep: string | undefined;
    if (provider.capabilities.has("startCampaign")) {
      await provider.startCampaign(providerCampaignId);
      status = "running";
    } else {
      manualStep =
        "Paste this batch's list into the voice platform and start it there — this integration cannot start a run by API.";
    }

    await db.$transaction([
      db.redialBatch.update({
        where: { id: batch.id },
        data: { status, providerCampaignId, providerError: null },
      }),
      db.campaignContact.updateMany({
        where: { id: { in: selected.map((c) => c.id) } },
        data: { redialBatchId: batch.id },
      }),
    ]);

    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "redial.batch_created",
      entityType: "redial_batch",
      entityId: batch.id,
      detail: { campaignId, filter, contacts: selected.length, provider: provider.name },
    });

    return {
      batchId: batch.id,
      filter,
      contactCount: selected.length,
      providerCampaignId,
      provider: `${provider.name} — ${reason}`,
      manualStep,
    };
  } catch (err) {
    const detail =
      err instanceof ProviderError
        ? `${err.message}${err.detail ? ` (${err.detail})` : ""}`
        : err instanceof Error
          ? err.message
          : "Unknown integration error";
    await db.redialBatch.update({
      where: { id: batch.id },
      data: { status: "failed", providerError: detail.slice(0, 500) },
    });
    console.error("[redial] batch failed:", err);
    throw err;
  }
}

/** The dialling list for one redial batch, for the paste workflow. */
export async function getRedialBatch(organizationId: string, batchId: string) {
  return db.redialBatch.findFirst({
    where: { id: batchId, organizationId },
    include: {
      contacts: {
        include: { debtor: { select: { firstName: true, lastName: true, phone: true, accountNumber: true } } },
      },
    },
  });
}
