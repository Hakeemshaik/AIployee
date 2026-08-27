import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { campaignCallLog } from "./campaign-calls";

// ---------------------------------------------------------------------------
// Attribution is the whole value of this view: a call shown against the wrong
// campaign is worse than no call list at all. So the rules are pinned against
// a real database — the identifier join beats the phone fallback, calls that
// predate the batch are excluded rather than counted, and another tenant's
// calls never appear.
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

const BATCH_SENT = new Date("2026-08-26T08:00:00.000Z");

describe.skipIf(!scratch)("campaignCallLog (integration)", () => {
  let orgId = "";
  let campaignId = "";
  let debtorId = "";

  beforeEach(async () => {
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.debtAccount.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
    const campaign = await db.campaign.create({
      data: {
        organizationId: orgId,
        name: "August recoveries",
        providerCampaignId: "26AUG-1Y2K",
        providerStartedAt: BATCH_SENT,
      },
    });
    campaignId = campaign.id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Thandi",
        lastName: "Mokoena",
        accountNumber: "ACC-1",
        phone: "+27821234567",
        providerContactUuid: "cust-abc",
        callBatch: "26AUG-1Y2K",
      },
    });
    debtorId = debtor.id;
  });

  async function addCall(
    uuid: string,
    overrides: { contactUuid?: string | null; phone?: string; startedAt?: Date; durationSeconds?: number },
  ) {
    return db.jobixConversation.create({
      data: {
        organizationId: orgId,
        uuid,
        phone: overrides.phone ?? "+27821234567",
        contactUuid: overrides.contactUuid ?? null,
        durationSeconds: overrides.durationSeconds ?? 40,
        startedAt: overrides.startedAt ?? new Date("2026-08-26T09:00:00.000Z"),
        sastHour: 11,
      },
    });
  }

  it("matches a call on the provider's customer identifier", async () => {
    await addCall("conv-1", { contactUuid: "cust-abc", phone: "+27000000000" });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.totalCalls).toBe(1);
    expect(log?.calls[0].matchedBy).toBe("contact_uuid");
    expect(log?.calls[0].debtorId).toBe(debtorId);
  });

  it("falls back to the phone number when the call carries no identifier", async () => {
    await addCall("conv-1", { contactUuid: null, phone: "0821234567" });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.totalCalls).toBe(1);
    expect(log?.calls[0].matchedBy).toBe("phone");
  });

  it("excludes and counts calls that predate the batch instead of folding them in", async () => {
    await addCall("before", { contactUuid: "cust-abc", startedAt: new Date("2026-08-20T09:00:00.000Z") });
    await addCall("after", { contactUuid: "cust-abc", startedAt: new Date("2026-08-26T09:00:00.000Z") });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.totalCalls).toBe(1);
    expect(log?.calls[0].conversationUuid).toBe("after");
    expect(log?.callsBeforeBatch).toBe(1);
  });

  it("numbers attempts chronologically and lists newest first", async () => {
    await addCall("second", { contactUuid: "cust-abc", startedAt: new Date("2026-08-27T09:00:00.000Z") });
    await addCall("first", { contactUuid: "cust-abc", startedAt: new Date("2026-08-26T09:00:00.000Z") });
    await addCall("third", { contactUuid: "cust-abc", startedAt: new Date("2026-08-28T09:00:00.000Z") });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.calls.map((c) => c.conversationUuid)).toEqual(["third", "second", "first"]);
    expect(log?.calls.map((c) => c.attempt)).toEqual([3, 2, 1]);
    expect(log?.accountsDialled).toBe(1);
  });

  it("reads reach from the transcript, not from talk time", async () => {
    const connected = await addCall("voicemail", { contactUuid: "cust-abc", durationSeconds: 32 });
    await db.jobixTranscript.create({
      data: {
        organizationId: orgId,
        conversationId: connected.id,
        conversationUuid: "voicemail",
        turns: "[]",
        userTurns: 1,
        userWords: 6,
        userText: "please leave a message after the tone",
        reached: false,
      },
    });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.totalCalls).toBe(1);
    expect(log?.reachedCalls).toBe(0);
    expect(log?.calls[0].reached).toBe(false);
    expect(log?.calls[0].reason).toMatch(/machine/i);
  });

  it("counts accounts carrying this campaign's batch code on the provider record", async () => {
    await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Sipho",
        lastName: "Ndlovu",
        accountNumber: "ACC-2",
        phone: "+27829999999",
        callBatch: "25AUG-OLD1",
      },
    });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.accountsInCampaign).toBe(2);
    expect(log?.accountsCarryingBatch).toBe(1);
  });

  it("never shows another organization's calls", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    await db.jobixConversation.create({
      data: {
        organizationId: other.id,
        uuid: "theirs",
        phone: "+27821234567",
        contactUuid: "cust-abc",
        durationSeconds: 60,
        startedAt: new Date("2026-08-26T09:00:00.000Z"),
        sastHour: 11,
      },
    });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.totalCalls).toBe(0);
  });

  it("returns null for a campaign belonging to someone else", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    expect(await campaignCallLog(other.id, campaignId)).toBeNull();
  });

  it("lists every call when no batch has been sent", async () => {
    await db.campaign.update({
      where: { id: campaignId },
      data: { providerCampaignId: null, providerStartedAt: null },
    });
    await addCall("old", { contactUuid: "cust-abc", startedAt: new Date("2026-01-01T09:00:00.000Z") });

    const log = await campaignCallLog(orgId, campaignId);

    expect(log?.batchCode).toBeNull();
    expect(log?.totalCalls).toBe(1);
    expect(log?.callsBeforeBatch).toBe(0);
  });
});
