import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { buildJobixExport, type JobixExport } from "@/services/jobix-export";
import { assertSingleOrganization } from "@/services/jobix/ingest";
import { batchCode, checkCallingWindow } from "@/services/jobix/calling";
import { JobixClient, JobixError, loadJobixEnv } from "@/services/jobix/client";

// ---------------------------------------------------------------------------
// Launching a campaign on the voice platform, as one connected flow.
//
// The reliable loop, built on what is verified rather than guessed:
//
//   1. Review — the campaign's contacts, categorised into who will be dialled
//      and who is excluded and why. Nothing is hidden: every exclusion carries
//      its reason and count.
//   2. Send the list — the platform generates the exact paste table Jobix's
//      database screen accepts, with this launch's batch code already written
//      into every row's `call` column. Pasting it is the one manual step, and
//      it replaces both the old import step AND the stamping step, because the
//      flow's entry filter gates on `call`.
//   3. Start — the platform triggers the flow's Now node (the captured,
//      confirmed endpoint). Jobix dials exactly the rows carrying this batch
//      code. The campaign is marked running only after the trigger succeeded.
//
// Results come back through ingestion as usual, keyed by phone number.
// ---------------------------------------------------------------------------

export type LaunchState = {
  campaignId: string;
  campaignName: string;
  status: string;
  batchCode: string | null;
  startedAt: Date | null;
  /** Who would be dialled right now, and who would not, with reasons. */
  eligible: number;
  totalValue: number;
  excluded: { reason: string; count: number }[];
  window: { allowed: boolean; reason: string; sastTime: string };
  callingEnabled: boolean;
  triggerConfigured: boolean;
  /** A pending scheduled start, when one is set. */
  scheduledFor: Date | null;
  /** Why the last scheduled start did not go ahead. */
  scheduleError: string | null;
};

async function campaignOrThrow(organizationId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { debtors: { select: { accounts: { select: { currentBalance: true } } } } },
  });
  if (!campaign) throw new JobixError("Campaign not found.", "not_found");
  return campaign;
}

export async function launchState(
  organizationId: string,
  campaignId: string,
): Promise<LaunchState> {
  const campaign = await campaignOrThrow(organizationId, campaignId);
  const preview = await buildJobixExport(organizationId, { campaignId });
  const eligibleValue = campaign.debtors.reduce(
    (sum, debtor) => sum + debtor.accounts.reduce((s, a) => s + a.currentBalance, 0),
    0,
  );
  return {
    campaignId: campaign.id,
    campaignName: campaign.name,
    status: campaign.status,
    batchCode: campaign.providerCampaignId,
    startedAt: campaign.providerStartedAt,
    eligible: preview.rowCount,
    totalValue: eligibleValue,
    excluded: preview.excluded,
    window: checkCallingWindow(),
    callingEnabled: process.env.JOBIX_CALLING_ENABLED === "true",
    triggerConfigured: !!process.env.JOBIX_FLOW_UUID && !!process.env.JOBIX_TRIGGER_NODE_UUID,
    scheduledFor: campaign.scheduledFor,
    scheduleError: campaign.scheduleError,
  };
}

/**
 * Generate the paste table for this campaign with a fresh batch code, and
 * remember the code on the campaign so Start can trigger against it.
 */
export async function prepareLaunchList(
  organizationId: string,
  userId: string,
  campaignId: string,
): Promise<JobixExport & { batchCode: string }> {
  const campaign = await campaignOrThrow(organizationId, campaignId);
  const code = batchCode();
  const exported = await buildJobixExport(organizationId, { campaignId, batchCode: code });
  if (exported.rowCount === 0) {
    throw new JobixError(
      "No contacts are eligible for dialling — every account in this campaign was excluded.",
      "rejected",
    );
  }
  await db.campaign.update({
    where: { id: campaign.id },
    data: { providerCampaignId: code, providerError: null },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.launch_list_generated",
    entityType: "campaign",
    entityId: campaign.id,
    detail: { batchCode: code, rows: exported.rowCount, excluded: exported.excluded },
  });
  return { ...exported, batchCode: code };
}

export type StartCallsResult = {
  triggered: boolean;
  batchCode: string;
  message: string;
};

/**
 * Trigger the flow for a prepared list. Every guardrail applies: explicit
 * confirmation, the calling-enabled flag, SAST calling hours, a configured
 * trigger, and a prepared batch code — with clear refusals for each.
 */
export async function startCampaignCalls(
  organizationId: string,
  userId: string,
  campaignId: string,
  options: { confirmed: boolean },
): Promise<StartCallsResult> {
  if (!options.confirmed) {
    throw new JobixError("Starting calls requires explicit confirmation.", "rejected");
  }
  if (process.env.JOBIX_CALLING_ENABLED !== "true") {
    throw new JobixError(
      "Calling is disabled on this deployment. An administrator must enable it after confirming the flow's entry filter gates on the `call` field.",
      "not_configured",
    );
  }
  const window = checkCallingWindow();
  if (!window.allowed) throw new JobixError(window.reason, "rejected");
  await assertSingleOrganization();

  const campaign = await campaignOrThrow(organizationId, campaignId);
  const code = campaign.providerCampaignId;
  if (!code) {
    throw new JobixError(
      "Generate and paste the dialling list first — there is no batch code to dial against.",
      "rejected",
    );
  }

  const env = loadJobixEnv();
  const nodeUuid = process.env.JOBIX_TRIGGER_NODE_UUID;
  if (!env || !env.flowUuid || !nodeUuid) {
    throw new JobixError(
      "The flow trigger is not configured. Set JOBIX_FLOW_UUID and JOBIX_TRIGGER_NODE_UUID.",
      "not_configured",
    );
  }

  const client = new JobixClient(env);
  const triggerPath = process.env.JOBIX_TRIGGER_PATH || "/api/nodes/now/trigger";
  await client.postDashboard(triggerPath, { flowUuid: env.flowUuid, nodeUuid });

  await db.campaign.update({
    where: { id: campaign.id },
    data: { status: "running", providerStartedAt: new Date(), providerError: null },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.calls_started",
    entityType: "campaign",
    entityId: campaign.id,
    detail: { batchCode: code, flowUuid: env.flowUuid },
  });

  return {
    triggered: true,
    batchCode: code,
    message: `The flow is running. Jobix dials the accounts whose call field carries ${code}. Run ingestion afterwards to pull the results in.`,
  };
}
