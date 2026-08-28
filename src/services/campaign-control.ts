import { createHash } from "crypto";
import { db } from "@/lib/db";
import { loadJobixEnv } from "@/services/jobix/client";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { getVoiceProvider } from "@/services/voice";
import { ProviderError, type ProviderContact } from "@/services/voice";

// ---------------------------------------------------------------------------
// Campaign execution control.
//
// The platform is the control centre: an operator starts, pauses and stops a
// campaign here, and this service drives the voice provider that actually
// dials. Two rules are absolute:
//
//   1. A campaign is never reported as running unless the provider accepted
//      it. A rejection leaves the campaign in `failed` with the real error
//      stored for the operator to see.
//   2. Starting twice never creates two provider campaigns — the idempotency
//      key is derived from the campaign and its contact set.
// ---------------------------------------------------------------------------

/** Debtor states that must never be dialled. */
const UNDIALLABLE_DEBTOR_STATUSES = ["paid", "opted_out", "dispute", "escalated", "legal", "uncontactable"];

export type StartResult = {
  status: string;
  providerCampaignId: string | null;
  contactsQueued: number;
  provider: string;
  /** Present when the provider needs an operator step (paste workflow). */
  manualStep?: string;
};

function idempotencyKey(campaignId: string, debtorIds: string[]): string {
  const digest = createHash("sha256").update(debtorIds.slice().sort().join(",")).digest("hex").slice(0, 16);
  return `${campaignId}:${digest}`;
}

/**
 * Materialise campaign membership. Debtors assigned to the campaign become
 * CampaignContact rows, which is what attempt counting and redial filters
 * read. Existing rows are preserved so attempt history survives a restart.
 */
export async function syncCampaignContacts(organizationId: string, campaignId: string) {
  const debtors = await db.debtor.findMany({
    where: { organizationId, campaignId },
    select: { id: true },
  });
  const existing = await db.campaignContact.findMany({
    where: { organizationId, campaignId },
    select: { debtorId: true },
  });
  const known = new Set(existing.map((c) => c.debtorId));
  const missing = debtors.filter((d) => !known.has(d.id));
  if (missing.length > 0) {
    await db.campaignContact.createMany({
      data: missing.map((d) => ({ organizationId, campaignId, debtorId: d.id })),
      skipDuplicates: true,
    });
  }
  return { total: debtors.length, added: missing.length };
}

/** Contacts eligible to be dialled right now, with per-campaign retry limits applied. */
export async function eligibleContacts(
  organizationId: string,
  campaignId: string,
  options: { maxAttempts?: number; contactIds?: string[] } = {},
) {
  const contacts = await db.campaignContact.findMany({
    where: {
      organizationId,
      campaignId,
      active: true,
      ...(options.contactIds ? { id: { in: options.contactIds } } : {}),
    },
    include: {
      debtor: { include: { accounts: { orderBy: { createdAt: "asc" } } } },
    },
  });

  return contacts.filter((c) => {
    if (c.debtor.doNotContact) return false;
    if (UNDIALLABLE_DEBTOR_STATUSES.includes(c.debtor.status)) return false;
    if (!/^\+\d{8,15}$/.test(c.debtor.phone)) return false;
    const balance = c.debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    if (balance <= 0) return false;
    if (options.maxAttempts != null && c.attempts >= options.maxAttempts) return false;
    return true;
  });
}

type EligibleContact = Awaited<ReturnType<typeof eligibleContacts>>[number];

export function toProviderContacts(contacts: EligibleContact[]): ProviderContact[] {
  return contacts.map((c) => {
    const balance = c.debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    const daysOverdue = Math.max(0, ...c.debtor.accounts.map((a) => a.daysOverdue));
    return {
      reference: c.id,
      name: `${c.debtor.firstName} ${c.debtor.lastName}`.trim(),
      phone: c.debtor.phone,
      email: c.debtor.email,
      accountNumber: c.debtor.accountNumber,
      amountDue: Math.round(balance),
      creditorName: c.debtor.accounts[0]?.creditorName ?? null,
      metadata: { days_overdue: daysOverdue, attempt: c.attempts + 1 },
    };
  });
}

export async function startCampaign(
  organizationId: string,
  userId: string,
  campaignId: string,
): Promise<StartResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { agent: true, organization: { select: { timezone: true } } },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (["running", "active", "queued"].includes(campaign.status)) {
    throw new ProviderError("This campaign is already running.", "rejected");
  }

  await syncCampaignContacts(organizationId, campaignId);
  const contacts = await eligibleContacts(organizationId, campaignId, {
    maxAttempts: campaign.maxAttempts,
  });
  if (contacts.length === 0) {
    throw new ProviderError(
      "No contacts are eligible to dial. Assign debtors to this campaign, or check that they have valid numbers, outstanding balances and are not suppressed.",
      "rejected",
    );
  }

  // The real connection first.
  //
  // Below this line is the provider abstraction, whose Jobix implementation
  // expects a REST campaign API that the real Jobix does not have — so it
  // resolves to the manual-paste stub, which reports contacts "queued" while
  // nothing at all reaches the voice platform. That is the worst possible
  // answer: it looks like a start. When a dashboard sign-in is configured, the
  // launch path that genuinely dials handles this instead, and its refusals
  // ("paste the list first", "calling is disabled") are surfaced as they are.
  const signIn = loadJobixEnv();
  if (signIn?.email && signIn?.password) {
    const { startCampaignCalls } = await import("@/services/campaign-launch");
    const started = await startCampaignCalls(organizationId, userId, campaignId, { confirmed: true });
    return {
      status: "running",
      providerCampaignId: started.batchCode,
      contactsQueued: contacts.length,
      provider: "Jobix — dashboard sign-in, flow trigger",
      manualStep: started.message,
    };
  }

  const { provider, reason } = await getVoiceProvider(organizationId);
  const key = campaign.idempotencyKey ?? idempotencyKey(campaignId, contacts.map((c) => c.debtorId));

  // queued first: if the provider call throws, the campaign is visibly mid-flight
  // rather than silently "draft".
  await db.campaign.update({
    where: { id: campaignId },
    data: { status: "queued", providerError: null, idempotencyKey: key },
  });

  try {
    const providerCampaignId =
      campaign.providerCampaignId ??
      (
        await provider.createCampaign({
          name: campaign.name,
          agentExternalId: campaign.agent?.externalId ?? null,
          callingHoursStart: campaign.callingHoursStart,
          callingHoursEnd: campaign.callingHoursEnd,
          maxAttempts: campaign.maxAttempts,
          retryIntervalHours: campaign.retryIntervalHours,
          timezone: campaign.organization.timezone,
          idempotencyKey: key,
        })
      ).providerCampaignId;

    await provider.addContacts(providerCampaignId, toProviderContacts(contacts));

    let status = "queued";
    let manualStep: string | undefined;
    if (provider.capabilities.has("startCampaign")) {
      const ref = await provider.startCampaign(providerCampaignId);
      status = "running";
      manualStep = ref.manualStep;
    } else {
      const ref = await provider.getCampaign(providerCampaignId);
      manualStep =
        ref.manualStep ??
        "Start the run in the voice platform dashboard — this integration cannot start it by API.";
    }

    await db.campaign.update({
      where: { id: campaignId },
      data: {
        status,
        providerCampaignId,
        providerStartedAt: new Date(),
        providerError: null,
        startDate: campaign.startDate ?? new Date(),
      },
    });
    await emitEvent({
      type: "campaign.started",
      organizationId,
      entityType: "campaign",
      entityId: campaignId,
      payload: { provider: provider.name, providerCampaignId, contacts: contacts.length },
    });
    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "campaign.started",
      entityType: "campaign",
      entityId: campaignId,
      detail: { provider: provider.name, contacts: contacts.length, providerCampaignId },
    });

    return {
      status,
      providerCampaignId,
      contactsQueued: contacts.length,
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
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "failed", providerError: detail.slice(0, 500) },
    });
    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: "campaign.start_failed",
      entityType: "campaign",
      entityId: campaignId,
      detail: { provider: provider.name },
    });
    console.error("[campaign-control] start failed:", err);
    throw err;
  }
}

async function transition(
  organizationId: string,
  userId: string,
  campaignId: string,
  action: "pause" | "stop",
): Promise<{ status: string; note?: string }> {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!campaign) throw new Error("Campaign not found");

  const { provider } = await getVoiceProvider(organizationId);
  const capability = action === "pause" ? "pauseCampaign" : "stopCampaign";
  const nextStatus = action === "pause" ? "paused" : "stopped";

  try {
    if (campaign.providerCampaignId && provider.capabilities.has(capability)) {
      if (action === "pause") await provider.pauseCampaign(campaign.providerCampaignId);
      else await provider.stopCampaign(campaign.providerCampaignId);
    } else if (campaign.providerCampaignId) {
      // No API for it. Recorded here and said plainly — but NOT written to
      // providerError, which the page renders as a red integration failure. A
      // known limitation of the platform is not something going wrong, and
      // dressing it as one teaches the operator to ignore real errors.
      await db.campaign.update({
        where: { id: campaignId },
        data: { status: nextStatus, providerError: null },
      });
      return {
        status: nextStatus,
        note: `Marked ${nextStatus} here. The voice platform has no API to ${action} a run, so ${action} it in the Jobix dashboard as well — calls already dialling will otherwise carry on.`,
      };
    }
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: nextStatus, providerError: null },
    });
    if (action === "stop") {
      await emitEvent({
        type: "campaign.completed",
        organizationId,
        entityType: "campaign",
        entityId: campaignId,
        payload: { reason: "stopped_by_operator" },
      });
    }
    await audit({
      organizationId,
      actorType: "user",
      actorId: userId,
      action: `campaign.${action}d`,
      entityType: "campaign",
      entityId: campaignId,
    });
    return { status: nextStatus };
  } catch (err) {
    const detail = err instanceof ProviderError ? err.message : "Integration error";
    await db.campaign.update({ where: { id: campaignId }, data: { providerError: detail } });
    throw err;
  }
}

export const pauseCampaign = (org: string, user: string, id: string) => transition(org, user, id, "pause");
export const stopCampaign = (org: string, user: string, id: string) => transition(org, user, id, "stop");
