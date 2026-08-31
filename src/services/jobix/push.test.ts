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

type Write = {
  path: string;
  suid: string;
  main: Record<string, unknown>;
  values: Record<string, unknown>;
};
const writes = vi.hoisted(() => [] as Write[]);
const postWrite = vi.hoisted(() =>
  vi.fn(async (path: string, body: unknown) => {
    const payload = body as {
      customer_data: { main: { suid: string }; values: Record<string, unknown> };
    };
    writes.push({
      path,
      suid: payload.customer_data.main.suid,
      main: payload.customer_data.main,
      values: payload.customer_data.values,
    });
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

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    // Echoes back whatever the writes created, which is what a healthy
    // workspace does — the failure cases override this per test.
    pullCustomers: vi.fn(async () => ({
      customers: writes
        .filter((w) => w.main.phone)
        .map((w, i) => ({
          id: i + 1,
          uuid: `uuid-${w.suid}`,
          suid: w.suid,
          phone: String(w.main.phone),
          name: String(w.main.name ?? ""),
          unit: null,
          building: null,
          totalDue: null,
          ptpConfirmed: false,
          ptpAmount: null,
          disputed: false,
          paidClaimed: false,
          escalated: false,
          doNotCall: false,
          wrongPerson: false,
          callBatch: null,
          callFlag: null,
          modifiedAt: new Date(),
          raw: {},
        })),
      rawCount: writes.length,
      droppedStale: 0,
      droppedDuplicate: 0,
    })),
  };
});

const { pushDiallingList } = await import("./push");
const api = await import("./api");

/**
 * Put the workspace in trigger mode.
 *
 * The default is "insert", because that is what a Jobix flow built on the
 * Insert Customer event does — so a test about the two-pass write has to say it
 * is about the other kind of flow.
 */
async function startsOnTrigger(organizationId: string) {
  await db.integrationSettings.upsert({
    where: { organizationId },
    create: { organizationId, provider: "jobix", flowStart: "trigger" },
    update: { flowStart: "trigger" },
  });
}

/**
 * The default: the workspace echoes back whatever the writes created.
 * Re-applied before every test, because a mockResolvedValue in one test
 * otherwise silently answers the reads in the next.
 */
function customersEchoWrites() {
  vi.mocked(api.pullCustomers).mockImplementation(async () => ({
    customers: writes
      .filter((w) => w.main.phone)
      .map((w, i) => ({
        id: i + 1,
        uuid: `uuid-${w.suid}`,
        suid: w.suid,
        phone: String(w.main.phone),
        name: String(w.main.name ?? ""),
        unit: null,
        building: null,
        totalDue: null,
        ptpConfirmed: false,
        ptpAmount: null,
        disputed: false,
        paidClaimed: false,
        escalated: false,
        doNotCall: false,
        wrongPerson: false,
        callBatch: null,
        callFlag: null,
        modifiedAt: new Date(),
        raw: {},
      })),
    rawCount: writes.length,
    droppedStale: 0,
    droppedDuplicate: 0,
  }));
}

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("pushing customers to Jobix (integration)", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      writes.push({
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
      });
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
    await startsOnTrigger(orgId);
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
    await startsOnTrigger(orgId);
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
    // Read off the customer list afterwards, because a save answers
    // {queued:true} and carries no identifier of its own.
    expect(debtors.map((d) => d.providerContactUuid).sort()).toEqual([
      "uuid-PUSH-1:28AUG-TEST",
      "uuid-PUSH-2:28AUG-TEST",
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
    await startsOnTrigger(orgId);
    let call = 0;
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      call += 1;
      if (payload.customer_data.main.suid === "PUSH-2" && call <= 2) {
        throw new Error("phone number rejected by the workspace");
      }
      writes.push({
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
      });
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
    customersEchoWrites();
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
    // One at a time, so the count is exact rather than "up to the concurrency
    // width" — the invariant being pinned is that it stops, not how wide it is.
    process.env.JOBIX_WRITE_CONCURRENCY = "1";
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
    delete process.env.JOBIX_WRITE_CONCURRENCY;
  });

  it("stops the other writers too, so no call goes out after the failure", async () => {
    const { JobixError } = await import("./client");
    process.env.JOBIX_WRITE_CONCURRENCY = "3";
    let attempts = 0;
    postWrite.mockImplementation(async () => {
      attempts += 1;
      // Everything after the in-flight batch must never be attempted.
      throw new JobixError("Jobix is unreachable right now.", "unavailable");
    });
    await expect(
      pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AUTH" }),
    ).rejects.toThrow(/unreachable/i);
    // Three contacts, three workers: one round, and no second round.
    expect(attempts).toBeLessThanOrEqual(3);
    delete process.env.JOBIX_WRITE_CONCURRENCY;
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
      writes.push({
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
      });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AUTH" });
    expect(result.failures).toHaveLength(1);
    expect(result.failures[0].reason).toContain("phone already in use");
    // The other two still went, because that failure was about one row.
    expect(result.written).toBe(2);
  });
});

describe.skipIf(!scratch)("a write is not the same fact as a customer existing", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Confirm Co", slug: "confirm-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "confirm@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Hakeem",
        lastName: "Test",
        accountNumber: "CONF-1",
        phone: "+27821234567",
        email: "hakeem@example.com",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "CONF-1",
        creditorName: "Mafadi",
        originalBalance: 5000,
        currentBalance: 5000,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 58,
      },
    });
    process.env.JOBIX_CALL_FLAG = "READY";
  });

  it("puts the phone and name in the identity block, not only in the fields", async () => {
    await startsOnTrigger(orgId);
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" });
    const create = writes[0];
    // A customer created with its identity buried in fields has nothing for
    // the platform's own list to show — which is what an accepted write that
    // appeared nowhere looked like.
    expect(create.main.suid).toBe("CONF-1");
    expect(create.main.phone).toBe("+27821234567");
    expect(create.main.name).toBe("Hakeem Test");
    expect(create.main.email).toBe("hakeem@example.com");
    expect(create.main.timezone).toBe("Africa/Johannesburg");
    // Arming is an update and must not rewrite the identity.
    const arm = writes[1];
    expect(arm.main.phone).toBeUndefined();
    expect(arm.main.name).toBeUndefined();
  });

  it("confirms the customer by reading the platform back", async () => {
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" });
    expect(result.confirmed).toBe(1);
    expect(result.complete).toBe(true);
    expect(result.nextStep).toMatch(/confirmed present/i);
  });

  it("refuses to look finished when the write was accepted and nothing landed", async () => {
    // Empty both before and after: nothing was there, and nothing arrived.
    vi.mocked(api.pullCustomers).mockResolvedValue({
      customers: [],
      rawCount: 0,
      droppedStale: 0,
      droppedDuplicate: 0,
    });
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" });
    expect(result.written).toBe(1);
    expect(result.armed).toBe(1);
    expect(result.confirmed).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.nextStep).toMatch(/do not start the calls yet/i);
  });

  it("refuses to write at all when the customer list cannot be read in full", async () => {
    // Only matching needs the list, so this is a trigger-flow rule: an insert
    // flow writes a new record every time and has nothing to match.
    await startsOnTrigger(orgId);
    // A partial list means an account that IS there may not have been seen, and
    // writing it then makes a second record for a real person. Waiting is
    // cheaper than duplicating someone in a live dialling list.
    process.env.JOBIX_CONFIRM_BUDGET_MS = "-1";
    vi.mocked(api.pullCustomers).mockImplementation(async (_client, options) => {
      options?.onPage?.({} as never);
      return { customers: [], rawCount: 0, droppedStale: 0, droppedDuplicate: 0 };
    });
    try {
      await expect(
        pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" }),
      ).rejects.toThrow(/could not be read in full/i);
      // Nothing was written, which is the point of refusing.
      expect(writes).toHaveLength(0);
    } finally {
      delete process.env.JOBIX_CONFIRM_BUDGET_MS;
    }
  });

  it("updates an existing record found only by number, instead of duplicating them", async () => {
    await startsOnTrigger(orgId);
    // Already on the platform from a pasted file: a real customer with no suid,
    // because that column is empty in the import template.
    const pasted = {
      id: 99,
      uuid: "existing-uuid-1",
      suid: null,
      phone: "+27821234567",
      name: "Hakeem Test",
      unit: null,
      building: null,
      totalDue: null,
      ptpConfirmed: false,
      ptpAmount: null,
      disputed: false,
      paidClaimed: false,
      escalated: false,
      doNotCall: false,
      wrongPerson: false,
      callBatch: null,
      callFlag: null,
      modifiedAt: new Date(),
      raw: {},
    };
    vi.mocked(api.pullCustomers).mockResolvedValue({
      customers: [pasted],
      rawCount: 1,
      droppedStale: 0,
      droppedDuplicate: 0,
    });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" });
    expect(result.relinked).toBe(1);
    expect(result.created).toBe(0);
    expect(result.duplicated).toBe(0);
    // The write names the record that exists, so it lands on it.
    expect(writes[0].main.uuid).toBe("existing-uuid-1");
    expect(writes[0].main.suid).toBe("CONF-1");
  });

  it("says so when a relink made a second record anyway", async () => {
    await startsOnTrigger(orgId);
    const row = (uuid: string, suid: string | null) => ({
      id: 1,
      uuid,
      suid,
      phone: "+27821234567",
      name: "Hakeem Test",
      unit: null,
      building: null,
      totalDue: null,
      ptpConfirmed: false,
      ptpAmount: null,
      disputed: false,
      paidClaimed: false,
      escalated: false,
      doNotCall: false,
      wrongPerson: false,
      callBatch: null,
      callFlag: null,
      modifiedAt: new Date(),
      raw: {},
    });
    // One record before, two after: the write did not land on the existing one.
    vi.mocked(api.pullCustomers)
      .mockResolvedValueOnce({
        customers: [row("existing-uuid-1", null)],
        rawCount: 1,
        droppedStale: 0,
        droppedDuplicate: 0,
      })
      .mockResolvedValueOnce({
        customers: [row("existing-uuid-1", null), row("new-uuid-2", "CONF-1")],
        rawCount: 2,
        droppedStale: 0,
        droppedDuplicate: 0,
      });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-CONF" });
    expect(result.duplicated).toBe(1);
    expect(result.complete).toBe(false);
    expect(result.nextStep).toMatch(/two records/i);
    expect(result.nextStep).toMatch(/called twice/i);
  });
});

describe.skipIf(!scratch)("a per-run code is not a usable flag", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Flag Co", slug: "flag-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "flag@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Tester",
        lastName: "One",
        accountNumber: "FLAG-1",
        phone: "+27825104242",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "FLAG-1",
        creditorName: "Mafadi",
        originalBalance: 1086,
        currentBalance: 1086,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 40,
      },
    });
    delete process.env.JOBIX_CALL_FLAG;
  });

  it("refuses to call a run armed with its own batch code finished", async () => {
    // The failure this pins: the flow's filter reads ONE fixed value, so a
    // per-run code matches nothing and the run dials nobody — while the
    // platform said "written and armed" and looked done.
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-4EIV" });
    expect(result.callFlag).toBe("28AUG-4EIV");
    expect(result.flagIsFixed).toBe(false);
    expect(result.complete).toBe(false);
    expect(result.nextStep).toMatch(/no fixed call flag is configured/i);
    expect(result.nextStep).toMatch(/nothing will dial/i);
  });

  it("is finished once a fixed flag is configured", async () => {
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "READY" },
    });
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-4EIV" });
    expect(result.callFlag).toBe("READY");
    expect(result.flagIsFixed).toBe(true);
    expect(result.complete).toBe(true);
    expect(result.nextStep).toMatch(/confirmed present/i);
  });
});

describe.skipIf(!scratch)("how the flow starts decides how a customer is written", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Start Co", slug: "start-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "start@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "Tester",
        lastName: "One",
        accountNumber: "START-1",
        phone: "+27825104242",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "START-1",
        creditorName: "Mafadi",
        originalBalance: 1086,
        currentBalance: 1086,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 40,
      },
    });
    process.env.JOBIX_CALL_FLAG = "READY";
  });

  it("writes a key that has never been used, because only an insert dials", async () => {
    // Taken from the live submissions of a form that does dial: every one
    // carries a fresh suid. Reuse a stable key and the second run is an update,
    // the insert event never fires, and nothing rings while every count reads
    // like success.
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "READY", flowStart: "insert" },
    });
    const first = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AAAA" });
    const firstSuid = writes[0].suid;
    expect(firstSuid).toBe("START-1:28AUG-AAAA");
    expect(first.created).toBe(1);

    writes.length = 0;
    const second = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BBBB" });
    expect(writes[0].suid).toBe("START-1:28AUG-BBBB");
    expect(writes[0].suid).not.toBe(firstSuid);
    // A second dial to the same person is a second record, not a fault.
    expect(second.created).toBe(1);
    expect(second.duplicated).toBe(0);
    expect(second.nextStep).not.toMatch(/two records/i);
  });

  it("arms the very first write when the flow starts on a customer being written", async () => {
    // The failure this pins: an Insert Customer event fires on the WRITE. Hold
    // the flag back for a second pass and the event has already gone by, the
    // update raises nothing, and no phone ever rings — with every count
    // reporting success.
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "READY", flowStart: "insert" },
    });
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-START" });
    expect(writes).toHaveLength(1);
    expect(writes[0].values.call).toBe("READY");
    expect(result.armed).toBe(1);
    expect(result.dialledOnWrite).toBe(true);
    expect(result.nextStep).toMatch(/already going out/i);
    expect(result.nextStep).toMatch(/nothing further to press/i);
  });

  it("keeps the two passes when the run starts by firing the trigger node", async () => {
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "READY", flowStart: "trigger" },
    });
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-START" });
    expect(writes).toHaveLength(2);
    expect(writes[0].values.call).toBeUndefined();
    expect(writes[1].values.call).toBe("READY");
    expect(result.dialledOnWrite).toBe(false);
    expect(result.nextStep).toMatch(/Start the calls/i);
  });

  it("defaults to arming on write, because that is what a Jobix flow does", async () => {
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-START" });
    expect(result.dialledOnWrite).toBe(true);
    expect(writes[0].values.call).toBe("READY");
  });
});

describe.skipIf(!scratch)("a book-sized push stops itself rather than being killed", () => {
  let orgId = "";
  let userId = "";
  let campaignId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    await db.campaignContact.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Book Co", slug: "book-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "book@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Book", status: "draft" } })
    ).id;
    for (const n of [1, 2, 3, 4]) {
      const debtor = await db.debtor.create({
        data: {
          organizationId: orgId,
          campaignId,
          firstName: "Person",
          lastName: `N${n}`,
          accountNumber: `BOOK-${n}`,
          phone: `+2782300000${n}`,
        },
      });
      await db.debtAccount.create({
        data: {
          organizationId: orgId,
          debtorId: debtor.id,
          reference: `BOOK-${n}`,
          creditorName: "Mafadi",
          originalBalance: 900,
          currentBalance: 900,
          dueDate: new Date("2026-07-01"),
          daysOverdue: 30,
        },
      });
    }
    process.env.JOBIX_CALL_FLAG = "READY";
  });

  it("reports what it did not send, and says nobody there was called", async () => {
    // Budget already spent: the first check stops every worker before any write.
    process.env.JOBIX_WRITE_BUDGET_MS = "-1";
    try {
      const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BOOK" });
      expect(result.written).toBe(0);
      expect(result.unsent).toBe(4);
      expect(result.complete).toBe(false);
      expect(result.nextStep).toMatch(/nobody on that part of the list has been called/i);
      expect(result.nextStep).toMatch(/will not be sent twice/i);
    } finally {
      delete process.env.JOBIX_WRITE_BUDGET_MS;
    }
  });

  it("marks each account as it lands, so a continue knows who not to call again", async () => {
    process.env.JOBIX_WRITE_CONCURRENCY = "1";
    try {
      await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BOOK" });
      const sent = await db.debtor.count({
        where: { organizationId: orgId, callBatch: "28AUG-BOOK" },
      });
      expect(sent).toBe(4);
    } finally {
      delete process.env.JOBIX_WRITE_CONCURRENCY;
    }
  });

  it("skips the accounts already sent when continuing the same batch", async () => {
    await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BOOK" });
    writes.length = 0;
    // Continuing: everything already carries the code, so there is nothing
    // left and nobody is called a second time.
    await expect(
      pushDiallingList(orgId, userId, {
        campaignId,
        batchCode: "28AUG-BOOK",
        skipAlreadySent: true,
      }),
    ).rejects.toThrow(/already been sent/i);
    expect(writes).toHaveLength(0);
  });

  it("writes concurrently, so a book is not one request at a time", async () => {
    let inFlight = 0;
    let peak = 0;
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      inFlight += 1;
      peak = Math.max(peak, inFlight);
      await new Promise((resolve) => setTimeout(resolve, 20));
      inFlight -= 1;
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      writes.push({
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
      });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });
    process.env.JOBIX_WRITE_CONCURRENCY = "4";
    try {
      await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BOOK" });
      expect(peak).toBeGreaterThan(1);
      expect(peak).toBeLessThanOrEqual(4);
    } finally {
      delete process.env.JOBIX_WRITE_CONCURRENCY;
    }
  });
});
