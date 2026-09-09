import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { startCampaign } from "./campaign-control";

// ---------------------------------------------------------------------------
// One Start, and it never lies.
//
// The bug this pins cost a real test run: the control bar's Start went through
// the provider abstraction, whose Jobix implementation expects a REST campaign
// API the real Jobix does not have. It therefore fell back to the manual-paste
// stub and answered "1 contact queued" — while nothing whatsoever reached the
// voice platform and the contact never appeared in its customer list.
//
// So when a dashboard sign-in is configured, Start must run the path that
// genuinely dials, and refuse out loud when the dialling list has not been sent
// yet. A refusal is a good outcome here. A cheerful "queued" is not.
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("campaign start (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";
  const original = { ...process.env };

  beforeEach(async () => {
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.platformEvent.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Control Co", slug: "control-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "control@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Test Run", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Hakeem",
        lastName: "Test",
        accountNumber: "SELF-1",
        phone: "+27821234567",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "SELF-1",
        creditorName: "Mafadi",
        originalBalance: 5000,
        currentBalance: 5000,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 58,
      },
    });

    delete process.env.JOBIX_CALLING_ENABLED;
    process.env.JOBIX_EMAIL = "ops@example.com";
    process.env.JOBIX_PASSWORD = "not-a-real-password";
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("refuses rather than reporting contacts queued when calling is off", async () => {
    await expect(startCampaign(orgId, userId, campaignId)).rejects.toThrow(/Calling is disabled/i);
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.status).not.toBe("queued");
    expect(campaign.status).not.toBe("running");
  });

  it("refuses when no dialling list has been sent, naming that as the next step", async () => {
    process.env.JOBIX_CALLING_ENABLED = "true";
    // Inside the calling window or not, the missing list must be reported —
    // both refusals are honest, and neither may become a "queued".
    await expect(startCampaign(orgId, userId, campaignId)).rejects.toThrow(
      /dialling list|calling window|Sunday/i,
    );
    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.providerCampaignId).toBeNull();
  });

  it("never routes to the manual paste stub while a sign-in is configured", async () => {
    process.env.JOBIX_CALLING_ENABLED = "true";
    const failure = await startCampaign(orgId, userId, campaignId).catch((err: Error) => err.message);
    expect(failure).not.toMatch(/manual/i);
    expect(failure).not.toMatch(/queued/i);
  });
});

describe.skipIf(!scratch)("deleting a campaign (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";
  let debtorId = "";

  beforeEach(async () => {
    await db.campaignContact.deleteMany();
    await db.redialBatch.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.platformEvent.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Del Co", slug: "del-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "del@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Old run", status: "draft" } })
    ).id;
    debtorId = (
      await db.debtor.create({
        data: {
          organizationId: orgId,
          campaignId,
          firstName: "Person",
          lastName: "One",
          accountNumber: "DEL-1",
          phone: "+27821110001",
        },
      })
    ).id;
    await db.campaignContact.create({
      data: { organizationId: orgId, campaignId, debtorId, attempts: 1, active: true },
    });
  });

  it("keeps the accounts and releases them, because the book is not the campaign", async () => {
    const { deleteCampaign } = await import("./campaign-control");
    const result = await deleteCampaign(orgId, userId, campaignId);
    expect(result.releasedAccounts).toBe(1);

    const debtor = await db.debtor.findUniqueOrThrow({ where: { id: debtorId } });
    expect(debtor.campaignId).toBeNull();
    expect(await db.campaign.count()).toBe(0);
    expect(await db.campaignContact.count()).toBe(0);
  });

  it("refuses while a run is live, so accounts cannot be left armed and unreachable", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { status: "running", providerCampaignId: "31AUG-LIVE" },
    });
    const { deleteCampaign } = await import("./campaign-control");
    await expect(deleteCampaign(orgId, userId, campaignId)).rejects.toThrow(/Stop it first/i);
    expect(await db.campaign.count()).toBe(1);
  });

  it("records the deletion, since a campaign holds the record of who was called", async () => {
    const { deleteCampaign } = await import("./campaign-control");
    await deleteCampaign(orgId, userId, campaignId);
    const entry = await db.auditLog.findFirst({ where: { action: "campaign.deleted" } });
    expect(entry).not.toBeNull();
    expect(entry!.detail).toContain("Old run");
  });

  it("will not delete another organization's campaign", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-del" } });
    const { deleteCampaign } = await import("./campaign-control");
    await expect(deleteCampaign(other.id, userId, campaignId)).rejects.toThrow(/not found/i);
    expect(await db.campaign.count()).toBe(1);
  });
});
