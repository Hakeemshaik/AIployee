import { db } from "@/lib/db";
import { callColumnValue, loadFlowConfig } from "@/services/flow-config";
import { audit } from "@/lib/audit";
import { buildJobixExport, type JobixExport } from "@/services/jobix-export";
import { pullCustomers } from "@/services/jobix/api";
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
    triggerConfigured: (await loadFlowConfig(organizationId)).triggerReady,
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

export type ArmedCheck = {
  /** What the flow's entry filter will look for. */
  flag: string | null;
  /** Records carrying anything in the `call` column — everything that dials. */
  armed: number;
  /** Of those, how many carry this run's batch code in `batch`. */
  armedForThisBatch: number;
  /** Records carrying the flag but a different batch — a previous run's
   *  leftovers, which would be dialled again. */
  armedForOtherBatch: number;
  /** How much of the customer database was actually read. */
  scanned: number;
  complete: boolean;
  verdict: string;
};

/**
 * Count what is actually armed to dial on the voice platform right now.
 *
 * With a fixed flag in the `call` column the flow's filter never changes, which
 * is the point — but it also means anything left carrying that flag from an
 * earlier run dials again. Nothing in the platform can see that; only the
 * provider's own records can answer it. So this reads them and says plainly
 * whether what is armed matches what this run intends.
 *
 * Advisory, not a gate: on a large database this cannot always finish inside a
 * request, so it reports how much it read rather than pretending to certainty.
 */
export async function checkArmed(
  organizationId: string,
  campaignId: string,
  options: { budgetMs?: number } = {},
): Promise<ArmedCheck> {
  const campaign = await campaignOrThrow(organizationId, campaignId);
  const env = loadJobixEnv();
  if (!env) throw new JobixError("Jobix is not configured on this server.", "not_configured");

  const flag = callColumnValue(await loadFlowConfig(organizationId), campaign.providerCampaignId ?? undefined);
  const deadline = Date.now() + (options.budgetMs ?? 45_000);
  let truncated = false;

  const client = new JobixClient(env);
  const { customers } = await pullCustomers(client, {
    onPage: () => {
      if (Date.now() > deadline) {
        truncated = true;
        return false;
      }
    },
  });

  const armedRecords = customers.filter((c) => !!c.callFlag);
  const armedForThisBatch = armedRecords.filter(
    (c) => campaign.providerCampaignId && c.callBatch === campaign.providerCampaignId,
  ).length;
  const armedForOtherBatch = armedRecords.length - armedForThisBatch;

  const verdict = truncated
    ? `Read ${customers.length} records before running out of time — treat these counts as a floor, not a total.`
    : armedForOtherBatch > 0
      ? `${armedForOtherBatch} records are armed but do not belong to this run. Triggering the flow would dial them too. Clear their call field on the platform, or make sure the flow clears it when a call finishes.`
      : armedRecords.length === 0
        ? "Nothing is armed. Paste the dialling list first, or the flow will dial nobody."
        : `${armedRecords.length} records armed, all belonging to this run.`;

  return {
    flag: flag ?? null,
    armed: armedRecords.length,
    armedForThisBatch,
    armedForOtherBatch,
    scanned: customers.length,
    complete: !truncated,
    verdict,
  };
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
  const flow = await loadFlowConfig(organizationId);
  if (!env || !flow.flowUuid || !flow.triggerNodeUuid) {
    throw new JobixError(
      "The flow trigger is not configured. Set the flow and its trigger node under Settings.",
      "not_configured",
    );
  }

  // The client's own flow id comes from the environment; the saved setting
  // wins, so changing flows never needs a redeploy.
  const client = new JobixClient({ ...env, flowUuid: flow.flowUuid });
  const triggerPath = process.env.JOBIX_TRIGGER_PATH || "/api/nodes/now/trigger";
  await client.postDashboard(triggerPath, {
    flowUuid: flow.flowUuid,
    nodeUuid: flow.triggerNodeUuid,
  });

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
    detail: { batchCode: code, flowUuid: flow.flowUuid },
  });

  return {
    triggered: true,
    batchCode: code,
    message: `The flow is running. Jobix dials the accounts whose call field carries ${code}. Run ingestion afterwards to pull the results in.`,
  };
}
