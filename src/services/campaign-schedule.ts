import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { checkCallingWindow } from "@/services/jobix/calling";
import { JobixError } from "@/services/jobix/client";
import { startCampaignCalls } from "./campaign-launch";

// ---------------------------------------------------------------------------
// Scheduling a campaign run.
//
// A schedule is a human pressing the button in advance, so it carries the same
// weight as a confirmation and is refused for the same reasons a live start
// would be — with one difference: the calling window is checked against the
// SCHEDULED time, not the current one. A run set for Sunday is refused when it
// is set, rather than silently failing at 09:00 on Sunday.
//
// The batch code has to exist first. The dialling list is generated here and
// pasted into the voice platform by hand, and the flow dials whatever carries
// that code, so a schedule with no prepared list has nothing to dial. Refusing
// early is the only honest option.
//
// Firing is driven from two places, because both matter:
//
//   * /api/cron/campaigns — unattended, on whatever cadence the host allows.
//   * /api/campaigns/due — the campaign page asks while somebody has it open,
//     which is what makes "start in five minutes" work on a host whose
//     scheduler only runs daily.
//
// Both funnel into runDueCampaigns, so there is one set of rules.
// ---------------------------------------------------------------------------

export type ScheduleState = {
  scheduledFor: Date | null;
  scheduledBy: string | null;
  scheduleError: string | null;
  batchCode: string | null;
  /** Whether the scheduled instant falls inside the calling window. */
  windowOk: boolean;
  windowReason: string;
};

/** The furthest ahead a run may be set. Beyond this the book is stale. */
export const MAX_SCHEDULE_DAYS = 14;
/** A schedule this close to now is treated as "start it on the next check". */
export const MIN_SCHEDULE_SECONDS = 30;

export async function scheduleState(
  organizationId: string,
  campaignId: string,
): Promise<ScheduleState | null> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: {
      scheduledFor: true,
      scheduledBy: true,
      scheduleError: true,
      providerCampaignId: true,
    },
  });
  if (!campaign) return null;
  const at = campaign.scheduledFor ?? new Date();
  const window = checkCallingWindow(at);
  return {
    scheduledFor: campaign.scheduledFor,
    scheduledBy: campaign.scheduledBy,
    scheduleError: campaign.scheduleError,
    batchCode: campaign.providerCampaignId,
    windowOk: window.allowed,
    windowReason: window.reason,
  };
}

export async function scheduleCampaign(
  organizationId: string,
  userId: string,
  campaignId: string,
  at: Date,
): Promise<ScheduleState> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, name: true, providerCampaignId: true, status: true },
  });
  if (!campaign) throw new JobixError("Campaign not found.", "not_found");

  if (Number.isNaN(at.getTime())) {
    throw new JobixError("That is not a valid date and time.", "rejected");
  }
  const secondsAway = (at.getTime() - Date.now()) / 1000;
  if (secondsAway < MIN_SCHEDULE_SECONDS) {
    throw new JobixError(
      `A scheduled start must be at least ${MIN_SCHEDULE_SECONDS} seconds away. To dial now, use Start calls.`,
      "rejected",
    );
  }
  if (secondsAway > MAX_SCHEDULE_DAYS * 86_400) {
    throw new JobixError(
      `A run cannot be scheduled more than ${MAX_SCHEDULE_DAYS} days ahead — the book would be stale by then.`,
      "rejected",
    );
  }
  // The window is checked against the scheduled instant. A run that could
  // never dial must be refused when it is set, not when it fires.
  const window = checkCallingWindow(at);
  if (!window.allowed) {
    throw new JobixError(`That time is outside the calling window. ${window.reason}`, "rejected");
  }
  if (!campaign.providerCampaignId) {
    throw new JobixError(
      "Generate the dialling list and paste it into the voice platform first — a scheduled start dials the batch code on that list, so there is nothing to dial without it.",
      "rejected",
    );
  }

  await db.campaign.update({
    where: { id: campaign.id },
    data: { scheduledFor: at, scheduledBy: userId, scheduleError: null },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.scheduled",
    entityType: "campaign",
    entityId: campaign.id,
    detail: { scheduledFor: at.toISOString(), batchCode: campaign.providerCampaignId },
  });

  return (await scheduleState(organizationId, campaign.id))!;
}

export async function cancelSchedule(
  organizationId: string,
  userId: string,
  campaignId: string,
): Promise<ScheduleState> {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    select: { id: true, scheduledFor: true },
  });
  if (!campaign) throw new JobixError("Campaign not found.", "not_found");

  await db.campaign.update({
    where: { id: campaign.id },
    data: { scheduledFor: null, scheduledBy: null, scheduleError: null },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.schedule_cancelled",
    entityType: "campaign",
    entityId: campaign.id,
    detail: { was: campaign.scheduledFor?.toISOString() ?? null },
  });

  return (await scheduleState(organizationId, campaign.id))!;
}

export type DueRunOutcome = {
  campaignId: string;
  campaignName: string;
  started: boolean;
  message: string;
};

/**
 * Start every campaign whose scheduled time has arrived.
 *
 * The schedule is cleared either way. A failed scheduled start does not retry
 * on the next tick — a run that keeps trying against a closed window or a
 * rejected trigger would dial when nobody expected it — so the reason is
 * stored on the campaign and shown on its page instead.
 */
export async function runDueCampaigns(organizationId: string): Promise<DueRunOutcome[]> {
  const due = await db.campaign.findMany({
    where: {
      organizationId,
      scheduledFor: { lte: new Date() },
      status: { not: "running" },
    },
    select: { id: true, name: true, scheduledBy: true },
    orderBy: { scheduledFor: "asc" },
    take: 10,
  });

  const outcomes: DueRunOutcome[] = [];
  for (const campaign of due) {
    try {
      // The schedule was the confirmation, set by the person named in
      // scheduledBy when they chose the time.
      const result = await startCampaignCalls(
        organizationId,
        campaign.scheduledBy ?? "scheduler",
        campaign.id,
        { confirmed: true },
      );
      await db.campaign.update({
        where: { id: campaign.id },
        data: { scheduledFor: null, scheduleError: null },
      });
      await audit({
        organizationId,
        actorType: "system",
        action: "campaign.scheduled_start_fired",
        entityType: "campaign",
        entityId: campaign.id,
        detail: { batchCode: result.batchCode },
      });
      outcomes.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        started: true,
        message: result.message,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : "the scheduled start failed";
      await db.campaign.update({
        where: { id: campaign.id },
        data: { scheduledFor: null, scheduleError: message.slice(0, 500) },
      });
      await audit({
        organizationId,
        actorType: "system",
        action: "campaign.scheduled_start_failed",
        entityType: "campaign",
        entityId: campaign.id,
        detail: { reason: message.slice(0, 500) },
      });
      outcomes.push({
        campaignId: campaign.id,
        campaignName: campaign.name,
        started: false,
        message,
      });
    }
  }
  return outcomes;
}
