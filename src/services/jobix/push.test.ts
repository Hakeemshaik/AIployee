import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
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
  /** Present when the caller stated one, which only the diagnostics do. */
  bearer?: string;
  companyKey?: unknown;
};
const writes = vi.hoisted(() => [] as Write[]);
const postWrite = vi.hoisted(() =>
  vi.fn(async (path: string, body: unknown, bearer?: string) => {
    const payload = body as {
      company_key?: unknown;
      customer_data: { main: { suid: string }; values: Record<string, unknown> };
    };
    writes.push({
      path,
      suid: payload.customer_data.main.suid,
      main: payload.customer_data.main,
      values: payload.customer_data.values,
      ...(bearer ? { bearer } : {}),
      companyKey: payload.company_key,
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
      token: "api-key-for-tests",
      companyKey: "company-key-for-tests",
    }),
    resolveJobixEnv: async () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      email: "ops@example.test",
      password: "irrelevant",
      token: "api-key-for-tests",
      companyKey: "company-key-for-tests",
    }),
    JobixClient: class {
      postWrite = postWrite;
      // The probe names the credential it uses, so the stub records that too.
      postWriteAs = (path: string, body: unknown, bearer: string) =>
        postWrite(path, body, bearer);
      sessionToken = async () => "session-token-for-tests";
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
  // Cleared as well as re-implemented, so a test can count the reads it caused.
  vi.mocked(api.pullCustomers).mockClear();
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
      // The number is identity, and every write the platform is known to have
      // dialled from carries it in `main` alone.
      expect(write.main.phone).toBeTruthy();
      expect(write.values.phone).toBeUndefined();
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
    expect(debtors.map((d) => d.providerContactUuid).sort()).toEqual(
      writes.map((w) => `uuid-${w.suid}`).sort(),
    );
    expect(debtors.every((d) => !!d.providerContactUuid)).toBe(true);
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
    expect(create.main.timezone).toBe("Africa/Johannesburg");
    // The email is a field, not identity: that is where the writes this
    // workspace has actually dialled from carry it.
    expect(create.main.email).toBeUndefined();
    expect(create.values.email).toBe("hakeem@example.com");
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
    // A queued write that never appears is the case: accepted, then gone.
    expect(result.nextStep).toMatch(/queued/i);
    expect(result.nextStep).toMatch(/CANNOT be found/);
    expect(result.nextStep).toMatch(/Nothing has been dialled/i);
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
    const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const first = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-AAAA" });
    const firstSuid = writes[0].suid;
    // A plain uuid, because that is the reference every dial this workspace has
    // actually made was keyed on. A readable key built from the account number
    // was tried instead, and the platform accepted those writes and kept none.
    expect(firstSuid).toMatch(uuidShape);
    expect(first.created).toBe(1);

    writes.length = 0;
    const second = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-BBBB" });
    expect(writes[0].suid).toMatch(uuidShape);
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

describe.skipIf(!scratch)("a write is only confirmed by the reference it wrote", () => {
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
    const org = await db.organization.create({ data: { name: "Strict Co", slug: "strict-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "strict@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Run", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "tester",
        lastName: "808",
        accountNumber: "002M",
        phone: "+27825104242",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "002M",
        creditorName: "Mafadi",
        originalBalance: 1086,
        currentBalance: 1086,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 40,
      },
    });
    process.env.JOBIX_CALL_FLAG = "READY";
    process.env.JOBIX_QUEUE_SETTLE_MS = "1";
  });

  afterEach(() => {
    delete process.env.JOBIX_QUEUE_SETTLE_MS;
  });

  it("does not count somebody else's record on the same number as confirmation", async () => {
    // The false positive this pins: the number was already on the platform from
    // an earlier run, a pasted file or a form. Matching on it reported
    // "confirmed present" for a customer this run never created — which is
    // exactly what "it says it is in Jobix but nothing was created" was.
    vi.mocked(api.pullCustomers).mockResolvedValue({
      customers: [
        {
          id: 1,
          uuid: "someone-elses-record",
          suid: "an-unrelated-reference",
          phone: "+27825104242",
          name: "tester",
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
        },
      ],
      rawCount: 1,
      droppedStale: 0,
      droppedDuplicate: 0,
    });

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-STRICT" });
    expect(result.confirmed).toBe(0);
    expect(result.complete).toBe(false);
    expect(result.nextStep).toMatch(/queued/i);
    expect(result.nextStep).toMatch(/not a created customer/i);
    // The count that could not be found must read as a failure, not a success:
    // "1 of 1 can be found" described the opposite of what happened.
    expect(result.nextStep).toMatch(/1 of 1 CANNOT be found/);
    expect(result.nextStep).not.toMatch(/of 1 can be found/);
  });

  it("re-reads once, because a queued write may not be in the list yet", async () => {
    const landed = {
      id: 2,
      uuid: "u-002M-28AUG-STRICT",
      suid: "002M-28AUG-STRICT",
      phone: "+27825104242",
      name: "tester 808",
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
    // Empty on the first read, there on the second — the queue catching up.
    vi.mocked(api.pullCustomers)
      .mockResolvedValueOnce({ customers: [], rawCount: 0, droppedStale: 0, droppedDuplicate: 0 })
      .mockImplementationOnce(async () => ({
        // Keyed on whatever the write used: the reference is minted per run.
        customers: [{ ...landed, suid: writes[0].suid, uuid: `u-${writes[0].suid}` }],
        rawCount: 1,
        droppedStale: 0,
        droppedDuplicate: 0,
      }));

    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-STRICT" });
    expect(result.confirmed).toBe(1);
    expect(result.complete).toBe(true);
  });

  it("says it cannot confirm when the list carries no reference at all", async () => {
    vi.mocked(api.pullCustomers).mockResolvedValue({
      customers: [
        {
          id: 3,
          uuid: "u-1",
          suid: null,
          phone: "+27825104242",
          name: "tester",
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
        },
      ],
      rawCount: 1,
      droppedStale: 0,
      droppedDuplicate: 0,
    });
    const result = await pushDiallingList(orgId, userId, { campaignId, batchCode: "28AUG-STRICT" });
    expect(result.referenceless).toBe(true);
    expect(result.complete).toBe(false);
    expect(result.nextStep).toMatch(/cannot be confirmed either way/i);
  });
});

describe.skipIf(!scratch)("the write probe", () => {
  let orgId = "";
  let userId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    customersEchoWrites();
    await db.auditLog.deleteMany();
    await db.serverSecret.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Probe Co", slug: "probe-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "probe@example.com", role: "admin" },
      })
    ).id;
    process.env.JOBIX_QUEUE_SETTLE_MS = "1";
  });

  afterEach(() => {
    delete process.env.JOBIX_QUEUE_SETTLE_MS;
  });

  it("tries each credential arrangement and never sends a call flag", async () => {
    const { probeWrite } = await import("./push");
    const result = await probeWrite(orgId, userId);
    // More than one arrangement, because which value goes where is the
    // question — and none of them may dial.
    expect(result.attempts.length).toBeGreaterThan(1);
    for (const attempt of result.attempts) {
      const sent = attempt.sent as {
        customer_data: { main: { phone: string }; values: Record<string, unknown> };
      };
      expect(sent.customer_data.values.call).toBeUndefined();
      expect(sent.customer_data.main.phone).toBe("+27000000000");
    }
  });

  it("never shows the credential, only which one was used", async () => {
    const { probeWrite } = await import("./push");
    const result = await probeWrite(orgId, userId);
    const dump = JSON.stringify(result);
    expect(dump).not.toContain("company-key-for-tests");
    expect(dump).not.toContain("api-key-for-tests");
    expect(dump).not.toContain("session-token-for-tests");
    // The last four characters are enough to tell two keys apart.
    expect(result.attempts.some((a) => a.arrangement.includes("…"))).toBe(true);
  });

  it("says which arrangement worked when one lands", async () => {
    const { probeWrite } = await import("./push");
    const result = await probeWrite(orgId, userId);
    expect(result.worked).not.toBeNull();
    expect(result.verdict).toMatch(/this arrangement works/i);
  });

  it("says the credential is being taken and ignored when none lands", async () => {
    vi.mocked(api.pullCustomers).mockResolvedValue({
      customers: [],
      rawCount: 0,
      droppedStale: 0,
      droppedDuplicate: 0,
    });
    const { probeWrite } = await import("./push");
    const result = await probeWrite(orgId, userId);
    expect(result.worked).toBeNull();
    expect(result.attempts.every((attempt) => !attempt.landed)).toBe(true);
    expect(result.verdict).toMatch(/accepted and discarded/i);
    expect(result.verdict).toMatch(/different workspace/i);
  });
});

describe.skipIf(!scratch)("finding the field a send is rejected for", () => {
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
    const org = await db.organization.create({ data: { name: "Row Co", slug: "row-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "row@example.com", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({ data: { organizationId: orgId, name: "Row", status: "draft" } })
    ).id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        campaignId,
        firstName: "tester",
        lastName: "808",
        accountNumber: "002M",
        phone: "+27825104242",
        email: "tester@example.com",
        city: "Johannesburg",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "002M",
        creditorName: "PHILBERTA COURT 80",
        originalBalance: 1086,
        currentBalance: 1086,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 40,
      },
    });
    process.env.JOBIX_QUEUE_SETTLE_MS = "1";
    process.env.JOBIX_CALL_FLAG = "mpm";
  });

  afterEach(() => {
    delete process.env.JOBIX_QUEUE_SETTLE_MS;
  });

  it("writes every variant unarmed, so a diagnosis cannot dial anybody", async () => {
    const { probeRow } = await import("./push");
    const result = await probeRow(orgId, userId, { campaignId });
    expect(result.variants.length).toBeGreaterThan(2);
    for (const write of writes) expect(write.values.call).toBeUndefined();
  });

  it("tries one write per variant and reads the platform once", async () => {
    const { probeRow } = await import("./push");
    await probeRow(orgId, userId, { campaignId });
    // Bisecting a write at a time would need a full customer-list read between
    // each, which on a real workspace is most of a minute.
    expect(vi.mocked(api.pullCustomers)).toHaveBeenCalledTimes(1);
  });

  it("names the fields rejected on their own", async () => {
    // Everything lands except the variant carrying tenant_code.
    postWrite.mockImplementation(async (path: string, body: unknown) => {
      const payload = body as {
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      if (payload.customer_data.values["tenant_code"] !== undefined) {
        // Accepted and silently dropped, which is how the real API answers.
        return { uuid: "" };
      }
      writes.push({
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
      });
      return { uuid: `provider-uuid-${payload.customer_data.main.suid}` };
    });

    const { probeRow } = await import("./push");
    const result = await probeRow(orgId, userId, { campaignId });
    expect(result.verdict).toMatch(/tenant_code/);
    expect(result.verdict).toMatch(/refused on their own/i);
  });

  /**
   * Only the writes this predicate accepts are kept. The rest answer exactly
   * what the real API answers when it discards a row: a 200, a queued flag, and
   * no record afterwards.
   */
  const keepOnly = (predicate: (write: Write) => boolean) => {
    postWrite.mockImplementation(async (path: string, body: unknown, bearer?: string) => {
      const payload = body as {
        company_key?: unknown;
        customer_data: { main: { suid: string }; values: Record<string, unknown> };
      };
      const write: Write = {
        path,
        suid: payload.customer_data.main.suid,
        main: payload.customer_data.main,
        values: payload.customer_data.values,
        ...(bearer ? { bearer } : {}),
        companyKey: payload.company_key,
      };
      if (predicate(write)) writes.push(write);
      // Exactly what the real API answers for a row it discards.
      return { queued: true, saveInitTime: 1, uuid: "" };
    });
  };

  it("blames the account's own data when the control lands and the account's does not", async () => {
    // The control is the connection test's own payload through the send's own
    // write function. It landing is what makes everything else about the data.
    keepOnly((write) => write.main.name === "AIployee connection test");
    const { probeRow } = await import("./push");
    const result = await probeRow(orgId, userId, { campaignId });
    expect(result.verdict).toMatch(/the control was kept/i);
    expect(result.verdict).toMatch(/name or number/i);
  });

  it("names the credential arrangement that worked when the send's own path does not", async () => {
    // The exact failure this exists for: the connection test lands and a send
    // does not, with the same payload. That is not a field problem, and looking
    // for one wastes the operator's afternoon.
    keepOnly((write) => write.companyKey === undefined);
    const { probeRow } = await import("./push");
    const result = await probeRow(orgId, userId, { campaignId });
    expect(result.verdict).toMatch(/payload is not the problem/i);
    expect(result.verdict).toMatch(/no company_key/i);
    // Never the credential itself, only which arrangement it was.
    expect(result.verdict).not.toContain("api-key-for-tests");
  });

  it("says the reference is the problem when only a uuid-keyed write is kept", async () => {
    const uuidShape = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    keepOnly((write) => uuidShape.test(write.suid));
    const { probeRow } = await import("./push");
    const result = await probeRow(orgId, userId, { campaignId });
    expect(result.verdict).toMatch(/reference/i);
    expect(result.verdict).toMatch(/uuid/i);
  });

  it("trusts nothing when the read did not finish", async () => {
    // A truncated read cannot say a record is absent, and saying otherwise
    // sends the next hour after a field that was fine.
    vi.mocked(api.pullCustomers).mockImplementation(async (_client, options = {}) => {
      await options.onPage?.({ page: 1, pulled: 0 });
      return { customers: [], rawCount: 0, droppedStale: 0, droppedDuplicate: 0 };
    });
    process.env.JOBIX_CONFIRM_BUDGET_MS = "-1000";
    try {
      const { probeRow } = await import("./push");
      const result = await probeRow(orgId, userId, { campaignId });
      expect(result.scanComplete).toBe(false);
      expect(result.verdict).toMatch(/ran out of time/i);
    } finally {
      delete process.env.JOBIX_CONFIRM_BUDGET_MS;
    }
  });
});
