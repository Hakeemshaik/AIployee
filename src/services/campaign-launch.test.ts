import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { launchState, prepareLaunchList, startCampaignCalls } from "./campaign-launch";
import { buildJobixExport, JOBIX_COLUMNS } from "./jobix-export";

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("campaign launch (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    delete process.env.JOBIX_CALLING_ENABLED;
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Launch Co", slug: "launch-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "ops@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({
        data: { organizationId: orgId, name: "September Arrears", status: "draft" },
      })
    ).id;

    const eligible = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Naledi",
        lastName: "M",
        accountNumber: "A-1",
        phone: "+27821110001",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: eligible.id,
        creditorName: "Rentals",
        reference: "REF-1",
        originalBalance: 5000,
        currentBalance: 5000,
        dueDate: new Date(),
      },
    });
    // One excluded contact, to prove the categorisation reaches the state.
    await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Dnc",
        lastName: "Person",
        accountNumber: "A-2",
        phone: "+27821110002",
        doNotContact: true,
      },
    });
  });

  it("reports eligible and excluded contacts with reasons", async () => {
    const state = await launchState(orgId, campaignId);
    expect(state.eligible).toBe(1);
    expect(state.excluded).toEqual([{ reason: "do-not-contact flag", count: 1 }]);
    expect(state.batchCode).toBeNull();
  });

  it("writes the batch code into every row's call column and persists it", async () => {
    const prepared = await prepareLaunchList(orgId, userId, campaignId);
    expect(prepared.rowCount).toBe(1);
    expect(prepared.batchCode).toMatch(/^[A-Z0-9-]{6,}$/i);

    const lines = prepared.csv.split("\n");
    const header = lines[0].split(",");
    const cells = lines[1].split(",");
    const callIndex = header.indexOf("call");
    const batchIndex = header.indexOf("batch");
    expect(callIndex).toBe(JOBIX_COLUMNS.length - 1);
    // The batch column is the attribution key and carries the run code.
    expect(cells[batchIndex]).toBe(prepared.batchCode);
    // With no fixed flag configured, the call column carries the code too —
    // which is the arrangement that makes the flow filter need editing.
    expect(cells[callIndex]).toBe(prepared.batchCode);
    expect(prepared.callFlag).toBe(prepared.batchCode);

    const campaign = await db.campaign.findUniqueOrThrow({ where: { id: campaignId } });
    expect(campaign.providerCampaignId).toBe(prepared.batchCode);
  });

  it("without a batch code the call column stays empty", async () => {
    const exported = await buildJobixExport(orgId, { campaignId });
    const lines = exported.csv.split("\n");
    expect(lines[1].split(",").at(-1)).toBe("");
    expect(exported.callFlag).toBeNull();
  });

  it("a configured flag goes in the call column so the flow filter is fixed", async () => {
    // The whole point: the flag is the same every run, so the flow's entry
    // filter is written once. The run code still travels, in `batch`.
    process.env.JOBIX_CALL_FLAG = "READY";
    try {
      const exported = await buildJobixExport(orgId, { campaignId, batchCode: "27AUG-ABCD" });
      const header = exported.csv.split("\n")[0].split(",");
      const cells = exported.csv.split("\n")[1].split(",");
      expect(cells[header.indexOf("call")]).toBe("READY");
      expect(cells[header.indexOf("batch")]).toBe("27AUG-ABCD");
      expect(exported.callFlag).toBe("READY");
    } finally {
      delete process.env.JOBIX_CALL_FLAG;
    }
  });

  it("refuses to start without confirmation, without the flag, and without a prepared list", async () => {
    await expect(
      startCampaignCalls(orgId, userId, campaignId, { confirmed: false }),
    ).rejects.toThrow(/confirmation/i);

    await expect(
      startCampaignCalls(orgId, userId, campaignId, { confirmed: true }),
    ).rejects.toThrow(/disabled/i);

    process.env.JOBIX_CALLING_ENABLED = "true";
    // In calling hours or not, the missing batch code must be reported when the
    // window allows; when the window is closed that refusal is fine too — both
    // are hard stops before any network call.
    await expect(
      startCampaignCalls(orgId, userId, campaignId, { confirmed: true }),
    ).rejects.toThrow(/(dialling list|calling window)/i);
    delete process.env.JOBIX_CALLING_ENABLED;
  });

  it("refuses an empty campaign rather than generating a useless list", async () => {
    const empty = await db.campaign.create({
      data: { organizationId: orgId, name: "Empty", status: "draft" },
    });
    await expect(prepareLaunchList(orgId, userId, empty.id)).rejects.toThrow(/excluded|No contacts/i);
  });
});
