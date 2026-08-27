import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";
import { cancelSchedule, runDueCampaigns, scheduleCampaign, scheduleState } from "./campaign-schedule";

// ---------------------------------------------------------------------------
// A schedule is a human pressing the dial button in advance, so it is refused
// for the same reasons a live start is — plus one more: the calling window is
// checked against the SCHEDULED instant, so a run that could never dial is
// refused when it is set rather than failing silently at the appointed hour.
//
// startCampaignCalls is mocked; everything it guards is tested with its own
// suite. What matters here is that the schedule fires exactly once, clears
// itself, and records why it did not go ahead.
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const startCalls = vi.hoisted(() => vi.fn());
vi.mock("./campaign-launch", () => ({ startCampaignCalls: startCalls }));

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

/** A Tuesday at 10:00 SAST — comfortably inside the calling window. */
function nextWorkingMorning(daysAhead = 1): Date {
  const sast = new Date(Date.now() + 2 * 3_600_000);
  const candidate = new Date(
    Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate() + daysAhead, 10) - 2 * 3_600_000,
  );
  const day = new Date(candidate.getTime() + 2 * 3_600_000).getUTCDay();
  // Skip Sunday (0) and Saturday afternoon is irrelevant at 10:00, but Sunday
  // is never allowed.
  return day === 0 ? nextWorkingMorning(daysAhead + 1) : candidate;
}

describe.skipIf(!scratch)("campaign scheduling (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    startCalls.mockResolvedValue({ triggered: true, batchCode: "26AUG-1Y2K", message: "The flow is running." });
    await db.auditLog.deleteMany();
    await db.campaign.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "ops@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({
        data: { organizationId: orgId, name: "August arrears", providerCampaignId: "26AUG-1Y2K" },
      })
    ).id;
  });

  it("stores a schedule and reports it back", async () => {
    const at = nextWorkingMorning();
    const state = await scheduleCampaign(orgId, userId, campaignId, at);

    expect(state.scheduledFor?.getTime()).toBe(at.getTime());
    expect(state.scheduleError).toBeNull();
    expect(state.windowOk).toBe(true);
    expect((await scheduleState(orgId, campaignId))?.scheduledFor?.getTime()).toBe(at.getTime());
  });

  it("refuses a time outside the calling window, when it is set", async () => {
    // The next Sunday at 10:00 SAST — never a calling day.
    const sast = new Date(Date.now() + 2 * 3_600_000);
    const daysToSunday = (7 - sast.getUTCDay()) % 7 || 7;
    const sunday = new Date(
      Date.UTC(sast.getUTCFullYear(), sast.getUTCMonth(), sast.getUTCDate() + daysToSunday, 10) -
        2 * 3_600_000,
    );

    await expect(scheduleCampaign(orgId, userId, campaignId, sunday)).rejects.toThrow(/calling window|Sunday/i);
    expect((await scheduleState(orgId, campaignId))?.scheduledFor).toBeNull();
  });

  it("refuses a time in the past and one too far ahead", async () => {
    await expect(
      scheduleCampaign(orgId, userId, campaignId, new Date(Date.now() - 60_000)),
    ).rejects.toThrow(/at least/i);
    await expect(
      scheduleCampaign(orgId, userId, campaignId, new Date(Date.now() + 40 * 86_400_000)),
    ).rejects.toThrow(/days ahead/i);
  });

  it("refuses to schedule a campaign with no prepared dialling list", async () => {
    await db.campaign.update({ where: { id: campaignId }, data: { providerCampaignId: null } });

    await expect(
      scheduleCampaign(orgId, userId, campaignId, nextWorkingMorning()),
    ).rejects.toThrow(/dialling list/i);
  });

  it("starts a due campaign once and clears the schedule", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { scheduledFor: new Date(Date.now() - 5_000), scheduledBy: userId },
    });

    const first = await runDueCampaigns(orgId);
    expect(first).toHaveLength(1);
    expect(first[0].started).toBe(true);
    expect(startCalls).toHaveBeenCalledTimes(1);
    expect(startCalls.mock.calls[0][3]).toEqual({ confirmed: true });

    // The schedule is gone, so a second tick does nothing.
    const second = await runDueCampaigns(orgId);
    expect(second).toHaveLength(0);
    expect(startCalls).toHaveBeenCalledTimes(1);
  });

  it("leaves a schedule alone until its time arrives", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { scheduledFor: new Date(Date.now() + 3_600_000), scheduledBy: userId },
    });

    expect(await runDueCampaigns(orgId)).toHaveLength(0);
    expect(startCalls).not.toHaveBeenCalled();
  });

  it("records why a scheduled start failed and does not retry it", async () => {
    startCalls.mockRejectedValue(new Error("Calling is disabled on this deployment."));
    await db.campaign.update({
      where: { id: campaignId },
      data: { scheduledFor: new Date(Date.now() - 5_000), scheduledBy: userId },
    });

    const outcomes = await runDueCampaigns(orgId);

    expect(outcomes[0].started).toBe(false);
    const after = await scheduleState(orgId, campaignId);
    expect(after?.scheduledFor).toBeNull();
    expect(after?.scheduleError).toMatch(/Calling is disabled/);
    // A failed start must not dial on the next tick, when nobody is watching.
    expect(await runDueCampaigns(orgId)).toHaveLength(0);
  });

  it("never starts another organization's due campaign", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    const theirs = await db.campaign.create({
      data: {
        organizationId: other.id,
        name: "Theirs",
        providerCampaignId: "OTHER-1",
        scheduledFor: new Date(Date.now() - 5_000),
      },
    });

    expect(await runDueCampaigns(orgId)).toHaveLength(0);
    expect(startCalls).not.toHaveBeenCalled();
    expect((await db.campaign.findUniqueOrThrow({ where: { id: theirs.id } })).scheduledFor).not.toBeNull();
  });

  it("cancels a schedule", async () => {
    await scheduleCampaign(orgId, userId, campaignId, nextWorkingMorning());

    const state = await cancelSchedule(orgId, userId, campaignId);

    expect(state.scheduledFor).toBeNull();
    expect(await runDueCampaigns(orgId)).toHaveLength(0);
  });

  it("does not start a campaign that is already running", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { scheduledFor: new Date(Date.now() - 5_000), scheduledBy: userId, status: "running" },
    });

    expect(await runDueCampaigns(orgId)).toHaveLength(0);
    expect(startCalls).not.toHaveBeenCalled();
  });
});
