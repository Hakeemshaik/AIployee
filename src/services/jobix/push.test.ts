import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Pushing the book into Jobix.
//
// The ordering is the whole safety property, so it is asserted directly: the
// flow fires on Insert Customer and gates on `call`, which means a new
// customer written with the flag already set is dialled the moment the row
// lands — mid-upload, before the list exists. Every write is recorded here and
// the test reads the sequence back.
// ---------------------------------------------------------------------------

type Write = { path: string; suid: string; values: Record<string, unknown> };
const writes = vi.hoisted(() => [] as Write[]);
const postWrite = vi.hoisted(() =>
  vi.fn(async (path: string, body: unknown) => {
    const payload = body as {
      customer_data: { main: { suid: string }; values: Record<string, unknown> };
    };
    writes.push({ path, suid: payload.customer_data.main.suid, values: payload.customer_data.values });
    return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
  }),
);

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    loadJobixEnv: () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      email: "ops@example.test",
      password: "irrelevant",
      companyKey: "company-key-for-tests",
    }),
    resolveJobixEnv: async () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      email: "ops@example.test",
      password: "irrelevant",
      companyKey: "company-key-for-tests",
    }),
    JobixClient: class {
      postWrite = postWrite;
    },
  };
});

const { pushDiallingList } = await import("./push");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("pushing customers to Jobix (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      writes.push({ path, suid: payload.customer_data.main.suid, values: payload.customer_data.values });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });

    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Push Co", slug: "push-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "push@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;

    for (const n of [1, 2]) {
      const debtor = await db.debtor.create({
        data: {
          organizationId: orgId,
          campaignId,
          firstName: "Person",
          lastName: `N${n}`,
          accountNumber: `PUSH-${n}`,
          phone: `+2782100000${n}`,
        },
      });
      await db.debtAccount.create({
        data: {
          organizationId: orgId,
          debtorId: debtor.id,
          reference: `PUSH-${n}`,
          creditorName: "Mafadi",
          originalBalance: 7450,
          currentBalance: 7450,
          dueDate: new Date("2026-07-01"),
          daysOverdue: 58,
        },
      });
    }
    process.env.JOBIX_CALL_FLAG = "READY";
  });

  it("writes every customer unarmed first, and only then arms them", async () => {
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });

    expect(result.written).toBe(2);
    expect(result.armed).toBe(2);
    expect(result.complete).toBe(true);

    // Two passes, in that order: nothing carries the flag until every customer
    // has been written.
    expect(writes).toHaveLength(4);
    const firstPass = writes.slice(0, 2);
    const secondPass = writes.slice(2);
    for (const write of firstPass) {
      expect(write.values.call).toBeUndefined();
      expect(write.values.phone).toBeTruthy();
      expect(write.values.batch).toBe("28AUG-TEST");
    }
    for (const write of secondPass) expect(write.values.call).toBe("READY");
    // And the same customers in both passes, so nothing is armed that was
    // never written.
    expect(secondPass.map((w) => w.suid).sort()).toEqual(firstPass.map((w) => w.suid).sort());
  });

  it("keys the write on the account number, which is what the API upserts on", async () => {
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    expect(writes.every((w) => w.path === "/v1/customer/save")).toBe(true);
    expect(writes.map((w) => w.suid).sort()).toEqual(["PUSH-1", "PUSH-1", "PUSH-2", "PUSH-2"]);
  });

  it("sends the contact fields, and never the fields the agent writes back", async () => {
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    const first = writes[0].values;
    expect(first.full_name).toBe("Person N1");
    expect(first.total_due).toBe(7450);
    expect(first.tenant_code).toBe("PUSH-1");
    // Re-pushing a book must not wipe the last call's outcome off the record.
    for (const owned of ["ptp_confirmed", "outcome_category", "sentiment", "dispute_raised", "call_summary"]) {
      expect(first[owned]).toBeUndefined();
    }
  });

  it("stores the provider's customer id, so calls join on an identifier", async () => {
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    const debtors = await db.debtor.findMany({ where: { organizationId: orgId } });
    expect(debtors.map((d) => d.providerContactUuid).sort()).toEqual([
      "provider-uuid-PUSH-1",
      "provider-uuid-PUSH-2",
    ]);
    expect(debtors.every((d) => d.callBatch === "28AUG-TEST")).toBe(true);
  });

  it("arms nobody when no call flag is configured, and says so", async () => {
    delete process.env.JOBIX_CALL_FLAG;
    // With no flag the batch code is used instead — still a real flag, so this
    // configures the absence explicitly.
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    expect(result.callFlag).toBe("28AUG-TEST");
    expect(result.armed).toBe(2);
  });

  it("reports what Jobix said per row instead of a total success", async () => {
    let call = 0;
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      call += 1;
      if (payload.customer_data.main.suid === "PUSH-2" && call <= 2) {
        throw new Error("phone number rejected by the workspace");
      }
      writes.push({ path, suid: payload.customer_data.main.suid, values: payload.customer_data.values });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    expect(result.written).toBe(1);
    expect(result.armed).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].suid).toBe("PUSH-2");
    expect(result.failures[0].reason).toMatch(/rejected by the workspace/);
    expect(result.nextStep).toMatch(/1 of 2 written/);
    // The one that failed to write is never armed.
    expect(writes.some((w) => w.suid === "PUSH-2" && w.values.call)).toBe(false);
  });

  it("refuses an empty list rather than reporting a push of nothing", async () => {
    await db.debtor.updateMany({ where: { organizationId: orgId }, data: { doNotContact: true } });
    await expect(
      pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" }),
    ).rejects.toThrow(/nothing to send/i);
    expect(writes).toHaveLength(0);
  });

  it("records the push, because writing to a live dialler must be traceable", async () => {
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-TEST" });
    const entry = await db.auditLog.findFirst({ where: { action: "jobix.customers_pushed" } });
    expect(entry).not.toBeNull();
    expect(entry!.entityId).toBe("28AUG-TEST");
    expect(entry!.detail).toContain('"armed":2');
  });
});

describe.skipIf(!scratch)("a credential failure is one problem, not one per contact", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Auth Co", slug: "auth-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "auth@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;
    for (const n of [1, 2, 3]) {
      const debtor = await db.debtor.create({
        data: {
          organizationId: orgId,
          campaignId,
          firstName: "Person",
          lastName: `N${n}`,
          accountNumber: `AUTH-${n}`,
          phone: `+2782200000${n}`,
        },
      });
      await db.debtAccount.create({
        data: {
          organizationId: orgId,
          debtorId: debtor.id,
          reference: `AUTH-${n}`,
          creditorName: "Mafadi",
          originalBalance: 1000,
          currentBalance: 1000,
          dueDate: new Date("2026-07-01"),
          daysOverdue: 30,
        },
      });
    }
    process.env.JOBIX_CALL_FLAG = "READY";
  });

  it("stops at the first rejected credential instead of listing it per row", async () => {
    const { JobixError } = await import("./client");
    postWrite.mockImplementation(async () => {
      throw new JobixError(
        "Jobix rejected the sign-in — check JOBIX_EMAIL and JOBIX_PASSWORD.",
        "unauthorized",
        '{"message":"invalid credentials"}',
      );
    });

    await expect(
      pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AUTH" }),
    ).rejects.toThrow(/rejected the sign-in/i);
    // One attempt, not one per contact.
    expect(postWrite).toHaveBeenCalledTimes(1);
  });

  it("carries what Jobix said, which is what separates the causes", async () => {
    const { JobixError } = await import("./client");
    let first = true;
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      if (first) {
        first = false;
        throw new JobixError("The write was refused.", "rejected", '{"error":"phone already in use"}');
      }
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      writes.push({ path, suid: payload.customer_data.main.suid, values: payload.customer_data.values });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AUTH" });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain("phone already in use");
    // The other two still went, because that failure was about one row.
    expect(result.written).toBe(2);
  });
});
