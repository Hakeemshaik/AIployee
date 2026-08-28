import { db } from "@/lib/db";
import { JobixError, resolveJobixEnv } from "@/services/jobix/client";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";

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
  /** What the operator does next, straight from the launch path. */
  manualStep?: string;
};

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

export async function startCampaign(
  organizationId: string,
  userId: string,
  campaignId: string,
): Promise<StartResult> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, status: true, maxAttempts: true },
  });
  if (!campaign) throw new Error("Campaign not found");
  if (["running", "active", "queued"].includes(campaign.status)) {
    throw new JobixError("This campaign is already running.", "rejected");
  }

  await syncCampaignContacts(organizationId, campaignId);
  const contacts = await eligibleContacts(organizationId, campaignId, {
    maxAttempts: campaign.maxAttempts,
  });
  if (contacts.length === 0) {
    throw new JobixError(
      "No contacts are eligible to dial. Assign debtors to this campaign, or check that they have valid numbers, outstanding balances and are not suppressed.",
      "rejected",
    );
  }

  // There is one way to start a run: send the dialling list, then trigger the
  // flow. What used to be here was a provider abstraction whose Jobix
  // implementation expected a REST campaign API that does not exist, so it
  // fell through to a paste stub and answered "contacts queued" while nothing
  // left the platform. Without a connection the honest answer is that there is
  // nothing to start.
  const signIn = await resolveJobixEnv();
  if (!signIn?.email || !signIn?.password) {
    throw new JobixError(
      "No voice platform is connected, so a run cannot be started. Set the sign-in under Settings, then send this campaign's dialling list.",
      "not_configured",
    );
  }

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

async function transition(
  organizationId: string,
  userId: string,
  campaignId: string,
  action: "pause" | "stop",
): Promise<{ status: string; note?: string }> {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!campaign) throw new Error("Campaign not found");

  const nextStatus = action === "pause" ? "paused" : "stopped";
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

  // Said plainly, and NOT written to providerError, which the page paints red:
  // the voice platform has no API to pause or stop a run, and a known
  // limitation is not something going wrong. Only offered once a run has
  // actually been sent — before that there is nothing running anywhere.
  const note = campaign.providerCampaignId
    ? `Marked ${nextStatus} here. The voice platform has no API to ${action} a run, so ${action} it in the Jobix dashboard as well — calls already dialling will otherwise carry on.`
    : undefined;

  return { status: nextStatus, note };
}

export const pauseCampaign = (org: string, user: string, id: string) => transition(org, user, id, "pause");
export const stopCampaign = (org: string, user: string, id: string) => transition(org, user, id, "stop");
