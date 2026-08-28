import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createRedialBatch } from "./redial";

// ---------------------------------------------------------------------------
// A redial batch is a dialling list, and the guarantee is that it holds the
// contacts matching the filter and nobody else.
//
// That used to be untestable end to end: the batch was "sent" to a provider
// abstraction with no real API behind it, so the only thing that could be
// checked was a count it reported about itself. Now the batch produces the
// actual paste table, so the guarantee can be read off the rows.
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("redial batch (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  async function addContact(opts: { n: number; outcome: string; attempts?: number }) {
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Person",
        lastName: `N${opts.n}`,
        accountNumber: `RD-${opts.n}`,
        phone: `+2782000${String(opts.n).padStart(4, "0")}`,
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: `RD-${opts.n}`,
        creditorName: "Mafadi",
        originalBalance: 4000,
        currentBalance: 4000,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 45,
      },
    });
    await db.campaignContact.create({
      data: {
        organizationId: orgId,
        campaignId,
        debtorId: debtor.id,
        attempts: opts.attempts ?? 1,
        lastOutcome: opts.outcome,
        lastAttemptAt: new Date("2026-08-27T09:00:00Z"),
        active: true,
      },
    });
    return debtor;
  }

  beforeEach(async () => {
    await db.campaignContact.deleteMany();
    await db.redialBatch.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Redial Co", slug: "redial-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "redial@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({
        data: { organizationId: orgId, name: "Arrears", status: "active", maxAttempts: 3 },
      })
    ).id;
    delete process.env.JOBIX_CALL_FLAG;
  });

  it("puts only the filtered contacts in the list, with the batch code on every row", async () => {
    const missed = await addContact({ n: 1, outcome: "no_answer" });
    const voicemail = await addContact({ n: 2, outcome: "voicemail" });
    const promised = await addContact({ n: 3, outcome: "promise_to_pay" });
    const exhausted = await addContact({ n: 4, outcome: "no_answer", attempts: 3 });

    const result = await createRedialBatch({
      organizationId: orgId,
      userId,
      campaignId,
      filter: "no_answer",
    });

    expect(result.contactCount).toBe(2);
    expect(result.rowCount).toBe(2);
    // Day, month, and a random suffix — e.g. 28AUG-4KRE.
    expect(result.batchCode).toMatch(/^\d{1,2}[A-Z]{3}-[A-Z0-9]{4}$/);

    const lines = result.csv.trim().split("\n");
    expect(lines).toHaveLength(3); // header + the two matches
    const body = lines.slice(1).join("\n");
    expect(body).toContain(missed.phone);
    expect(body).toContain(voicemail.phone);
    // The promise and the contact over its attempt limit must not be dialled.
    expect(body).not.toContain(promised.phone);
    expect(body).not.toContain(exhausted.phone);
    // Every row carries the code, which is how these calls come back attributed.
    for (const line of lines.slice(1)) expect(line).toContain(result.batchCode!);
  });

  it("arms the rows with the flow's flag when one is configured", async () => {
    process.env.JOBIX_CALL_FLAG = "READY";
    await addContact({ n: 5, outcome: "busy" });
    const result = await createRedialBatch({
      organizationId: orgId,
      userId,
      campaignId,
      filter: "busy",
    });
    expect(result.csv).toContain("READY");
    delete process.env.JOBIX_CALL_FLAG;
  });

  it("records the batch as prepared, not queued — the platform does not have it yet", async () => {
    await addContact({ n: 6, outcome: "failed" });
    const result = await createRedialBatch({
      organizationId: orgId,
      userId,
      campaignId,
      filter: "failed",
    });
    const batch = await db.redialBatch.findUniqueOrThrow({ where: { id: result.batchId } });
    expect(batch.status).toBe("prepared");
    expect(batch.providerCampaignId).toBe(result.batchCode);
    expect(batch.providerError).toBeNull();
  });

  it("returns the existing batch on a repeat instead of dialling everyone twice", async () => {
    await addContact({ n: 7, outcome: "no_answer" });
    const first = await createRedialBatch({
      organizationId: orgId,
      userId,
      campaignId,
      filter: "no_answer",
    });
    const second = await createRedialBatch({
      organizationId: orgId,
      userId,
      campaignId,
      filter: "no_answer",
    });
    expect(second.batchId).toBe(first.batchId);
    expect(second.batchCode).toBe(first.batchCode);
    expect(second.nextStep).toMatch(/already exists/i);
    expect(await db.redialBatch.count()).toBe(1);
  });

  it("refuses when nothing matches, rather than falling back to the whole campaign", async () => {
    await addContact({ n: 8, outcome: "promise_to_pay" });
    await expect(
      createRedialBatch({ organizationId: orgId, userId, campaignId, filter: "no_answer" }),
    ).rejects.toThrow(/No contacts match/i);
    expect(await db.redialBatch.count()).toBe(0);
  });
});
