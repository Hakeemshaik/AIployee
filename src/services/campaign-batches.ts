import { createHash } from "crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { getVoiceProvider, ProviderError } from "@/services/voice";
import { eligibleContacts, syncCampaignContacts, toProviderContacts } from "@/services/campaign-control";

// ---------------------------------------------------------------------------
// Batched campaign runs.
//
// A campaign is worked a batch at a time rather than pushed at the dialler in
// one go: release 150, watch them land, then release the next 150. That keeps
// the provider queue predictable, keeps the operator in control, and means a
// bad agent prompt costs one batch instead of the whole book.
//
// "Never dialled" is tracked by batch membership, not by attempt count.
// CampaignContact.attempts only increases when a call result comes back, so a
// contact that has been sent but has not been called yet still reads as zero
// attempts — selecting on that alone would put it in the next batch too.
// ---------------------------------------------------------------------------

export const DEFAULT_BATCH_SIZE = 150;

export type BatchSummary = {
  id: string;
  sequence: number;
  contactCount: number;
  status: string;
  createdAt: Date;
  providerError: string | null;
};

export type BatchPlan = {
  batchSize: number;
  /** Contacts assigned to the campaign, before any exclusion. */
  assigned: number;
  /** Contacts that could be dialled at all (valid number, balance, not suppressed). */
  eligible: number;
  /** Eligible contacts already released in a batch. */
  released: number;
  /** Eligible contacts still waiting for a batch. */
  remaining: number;
  /** Held back by suppression, bad numbers, settled balances or the attempt cap. */
  excluded: number;
  nextSequence: number;
  nextBatchSize: number;
  batches: BatchSummary[];
  /** True once every eligible contact has been released at least once. */
  complete: boolean;
};

export type BatchResult = {
  batchId: string;
  sequence: number;
  contactCount: number;
  remainingAfter: number;
  providerCampaignId: string | null;
  provider: string;
  manualStep?: string;
};

/** The shape the batch selector needs — anything wider is irrelevant to it. */
export type SelectableContact = {
  redialBatchId: string | null;
  attempts: number;
  debtor: { accounts: { currentBalance: number }[] };
};

export function outstandingBalance(contact: SelectableContact): number {
  return contact.debtor.accounts.reduce((sum, a) => sum + a.currentBalance, 0);
}

/**
 * Contacts that have never been sent to the dialler, biggest balance first.
 *
 * Exported and pure so the rule is tested directly rather than through a copy
 * of it. Both conditions matter: `redialBatchId` catches contacts already sent
 * whose results have not come back yet, `attempts` catches contacts dialled
 * before batching existed.
 */
export function selectUnreleased<T extends SelectableContact>(contacts: T[]): T[] {
  return contacts
    .filter((c) => c.redialBatchId === null && c.attempts === 0)
    .sort((a, b) => outstandingBalance(b) - outstandingBalance(a));
}

async function unreleasedContacts(organizationId: string, campaignId: string, maxAttempts: number) {
  const dialable = await eligibleContacts(organizationId, campaignId, { maxAttempts });
  return selectUnreleased(dialable);
}

/**
 * Current batch position.
 *
 * `sync` materialises campaign membership first, which writes. The live view
 * polls this on a timer, so it passes sync=false — only the page render and
 * the run action need the write.
 */
export async function getBatchPlan(
  organizationId: string,
  campaignId: string,
  { sync = false }: { sync?: boolean } = {},
): Promise<BatchPlan> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { batchSize: true, maxAttempts: true },
  });
  if (!campaign) throw new Error("Campaign not found");

  if (sync) await syncCampaignContacts(organizationId, campaignId);

  const [assigned, dialable, batches] = await Promise.all([
    db.campaignContact.count({ where: { organizationId, campaignId } }),
    eligibleContacts(organizationId, campaignId, { maxAttempts: campaign.maxAttempts }),
    db.redialBatch.findMany({
      where: { organizationId, campaignId, kind: "initial" },
      orderBy: { sequence: "asc" },
      select: {
        id: true,
        sequence: true,
        contactCount: true,
        status: true,
        createdAt: true,
        providerError: true,
      },
    }),
  ]);

  const remaining = selectUnreleased(dialable).length;
  const batchSize = campaign.batchSize || DEFAULT_BATCH_SIZE;

  return {
    batchSize,
    assigned,
    eligible: dialable.length,
    released: dialable.length - remaining,
    remaining,
    excluded: assigned - dialable.length,
    nextSequence: (batches[batches.length - 1]?.sequence ?? 0) + 1,
    nextBatchSize: Math.min(batchSize, remaining),
    batches,
    complete: remaining === 0 && batches.length > 0,
  };
}

/**
 * Release the next batch to the dialler.
 *
 * The contacts are stamped with the batch before the provider is told to
 * start, so a crash between the two leaves them held back rather than
 * released twice. Idempotency on the contact set means a double-clicked
 * button cannot dial anyone twice either.
 */
export async function startNextBatch({
  organizationId,
  userId,
  campaignId,
  size,
}: {
  organizationId: string;
  userId: string;
  campaignId: string;
  size?: number;
}): Promise<BatchResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { agent: true, organization: { select: { timezone: true } } },
  });
  if (!campaign) throw new Error("Campaign not found");

  await syncCampaignContacts(organizationId, campaignId);

  const batchSize = Math.max(1, size ?? campaign.batchSize ?? DEFAULT_BATCH_SIZE);
  const waiting = await unreleasedContacts(organizationId, campaignId, campaign.maxAttempts);

  if (waiting.length === 0) {
    const assigned = await db.campaignContact.count({ where: { organizationId, campaignId } });
    throw new ProviderError(
      assigned === 0
        ? "No debtors are assigned to this campaign yet. Import a list or assign debtors, then run the first batch."
        : "Every contact in this campaign has already been released. Use Resync, then redial the ones who did not pick up.",
      "rejected",
    );
  }

  const selected = waiting.slice(0, batchSize);
  const previous = await db.redialBatch.findFirst({
    where: { organizationId, campaignId, kind: "initial" },
    orderBy: { sequence: "desc" },
    select: { sequence: true },
  });
  const sequence = (previous?.sequence ?? 0) + 1;

  const key = `${campaignId}:batch:${createHash("sha256")
    .update(selected.map((c) => c.id).sort().join(","))
    .digest("hex")
    .slice(0, 16)}`;

  const existing = await db.redialBatch.findUnique({ where: { idempotencyKey: key } });
  if (existing) {
    return {
      batchId: existing.id,
      sequence: existing.sequence,
      contactCount: existing.contactCount,
      remainingAfter: waiting.length - existing.contactCount,
      providerCampaignId: existing.providerCampaignId,
      provider: "existing batch (idempotent replay)",
    };
  }

  const batch = await db.redialBatch.create({
    data: {
      organizationId,
      campaignId,
      kind: "initial",
      sequence,
      filter: "batch",
      contactCount: selected.length,
      maxRetries: campaign.maxAttempts,
      status: "queued",
      idempotencyKey: key,
      createdByUserId: userId,
    },
  });

  // Stamp membership first: if the provider call fails, these contacts stay
  // held back and the operator retries the batch rather than the whole book
  // silently going out twice.
  await db.campaignContact.updateMany({
    where: { id: { in: selected.map((c) => c.id) } },
    data: { redialBatchId: batch.id },
  });

  const { provider, reason } = await getVoiceProvider(organizationId);

  try {
    const providerCampaignId = (
      await provider.createCampaign({
        name: `${campaign.name} — batch ${sequence}`,
        agentExternalId: campaign.agent?.externalId ?? null,
        callingHoursStart: campaign.callingHoursStart,
        callingHoursEnd: campaign.callingHoursEnd,
        maxAttempts: campaign.maxAttempts,
        retryIntervalHours: campaign.retryIntervalHours,
        timezone: campaign.organization.timezone,
        idempotencyKey: key,
      })
    ).providerCampaignId;

    await provider.addContacts(providerCampaignId, toProviderContacts(selected));

    let status = "running";
    let manualStep: string | undefined;
    if (provider.capabilities.has("startCampaign")) {
      const ref = await provider.startCampaign(providerCampaignId);
      manualStep = ref.manualStep;
    } else {
      status = "queued";
      manualStep =
        "Start this batch in the voice platform dashboard — this integration cannot start a run by API.";
    }

    await db.$transaction([
      db.redialBatch.update({
        where: { id: batch.id },
        data: { status, providerCampaignId, providerError: null },
      }),
      db.campaign.update({
        where: { id: campaignId },
        data: {
          status: status === "running" ? "running" : "queued",
          providerCampaignId,
          providerStartedAt: campaign.providerStartedAt ?? new Date(),
          providerError: null,
          startDate: campaign.startDate ?? new Date(),
        },
      }),
    ]);

    await emitEvent({
      type: "campaign.started",
      organizationId,
      entityType: "campaign",
      entityId: campaignId,
      payload: { provider: provider.name, providerCampaignId, batch: sequence, contacts: selected.length },
    });
    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "campaign.batch_started",
      entityType: "redial_batch",
      entityId: batch.id,
      detail: { campaignId, sequence, contacts: selected.length, provider: provider.name },
    });

    return {
      batchId: batch.id,
      sequence,
      contactCount: selected.length,
      remainingAfter: waiting.length - selected.length,
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

    // Hand the contacts back so the batch can be retried.
    await db.campaignContact.updateMany({
      where: { redialBatchId: batch.id },
      data: { redialBatchId: null },
    });
    await db.redialBatch.update({
      where: { id: batch.id },
      data: { status: "failed", providerError: detail.slice(0, 500), contactCount: 0 },
    });
    await db.campaign.update({
      where: { id: campaignId },
      data: { providerError: detail.slice(0, 500) },
    });
    console.error("[campaign-batches] batch failed:", err);
    throw err;
  }
}
