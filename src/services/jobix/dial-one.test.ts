import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// One submit, one insert, one call.
//
// The payload shape is not a guess here: it is the field mapping the working
// form publishes — name in `main` mirrored to `values.full_name`, the number in
// `main` and nowhere else, the flag in `values.call`, and a fresh uuid as the
// reference. Each of those is asserted, because each of them was wrong at some
// point and every one of them fails the same silent way: a 200, a queued flag,
// and no customer.
//
// The guardrails are asserted too. This is the one path that dials a single
// real phone on one click, which makes it the likeliest place for a rule to be
// quietly skipped.
// ---------------------------------------------------------------------------

type Write = { path: string; body: unknown };
const writes = vi.hoisted(() => [] as Write[]);
const postWrite = vi.hoisted(() =>
  vi.fn(async (path: string, body: unknown) => {
    writes.push({ path, body });
    return { queued: true, saveInitTime: 1788000000000 };
  }),
);

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    resolveJobixEnv: async () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      token: "api-key-for-tests",
      companyKey: "company-key-for-tests",
    }),
    JobixClient: class {
      postWrite = postWrite;
    },
  };
});

const { dialOne } = await import("./dial-one");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

/** Inside the Tuesday window: 10:00 SAST. */
const OPEN = new Date("2026-09-01T08:00:00Z");

describe.skipIf(!scratch)("dialling one account (integration)", () => {
  let orgId = "";
  let userId = "";
  let debtorId = "";

  beforeEach(async () => {
    writes.length = 0;
    postWrite.mockClear();
    vi.useFakeTimers();
    vi.setSystemTime(OPEN);
    process.env.JOBIX_CALLING_ENABLED = "true";
    delete process.env.JOBIX_DENY_LIST;

    await db.debtAccount.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.debtor.deleteMany();
    await db.auditLog.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Dial Co", slug: "dial-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "dial@example.com", role: "admin" },
      })
    ).id;
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "mafadi_air" },
    });
    debtorId = (
      await db.debtor.create({
        data: {
          organizationId: orgId,
          firstName: "Hakeem",
          lastName: "Shaik",
          accountNumber: "DIAL-1",
          phone: "+27825104242",
          email: "hakeem@example.com",
        },
      })
    ).id;
  });

  afterEach(() => {
    vi.useRealTimers();
    delete process.env.JOBIX_CALLING_ENABLED;
  });

  it("writes the shape the working form publishes, and only that", async () => {
    const result = await dialOne(orgId, userId, { debtorId });

    expect(writes).toHaveLength(1);
    const body = writes[0].body as {
      company_key: string;
      customer_data: { main: Record<string, unknown>; values: Record<string, unknown> };
    };
    expect(writes[0].path).toBe("/v1/customer/save");
    expect(body.company_key).toBe("company-key-for-tests");

    // Identity in main: the reference, the timezone, the number and the name.
    expect(body.customer_data.main).toEqual({
      suid: result.suid,
      timezone: "Africa/Johannesburg",
      phone: "+27825104242",
      name: "Hakeem Shaik",
    });
    // A fresh uuid — the form mints one per submit, and an insert is what fires
    // the flow. A reused reference is an update and rings nobody.
    expect(result.suid).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);

    // The name is mirrored into the fields; the number is NOT.
    expect(body.customer_data.values.full_name).toBe("Hakeem Shaik");
    expect(body.customer_data.values.phone).toBeUndefined();
    expect(body.customer_data.values.email).toBe("hakeem@example.com");
    // The flag the flow's entry filter matches, in both spellings a working
    // dial carries.
    expect(body.customer_data.values.call).toBe("mafadi_air");
    expect(body.customer_data.values.all).toBe("mafadi_air");
  });

  it("mints a different reference every time, so a second call is a second insert", async () => {
    const first = await dialOne(orgId, userId, { debtorId });
    const second = await dialOne(orgId, userId, { debtorId });
    expect(second.suid).not.toBe(first.suid);
  });

  it("never shows the credential, even in what it reports back", async () => {
    const result = await dialOne(orgId, userId, { debtorId });
    expect(JSON.stringify(result)).not.toContain("company-key-for-tests");
    expect(JSON.stringify(result)).not.toContain("api-key-for-tests");
  });

  it("records who dialled whom, because a call to a real person is traceable", async () => {
    const result = await dialOne(orgId, userId, { debtorId });
    const entry = await db.auditLog.findFirst({ where: { action: "jobix.dialled_one" } });
    expect(entry?.actorId).toBe(userId);
    expect(entry?.entityId).toBe(debtorId);
    expect(JSON.stringify(entry?.detail)).toContain(result.suid);
  });

  it("dials a name and number given directly, which is how you test your own phone", async () => {
    const result = await dialOne(orgId, userId, { name: "Test Line", phone: "+27 82 555 1234" });
    const body = writes[0].body as { customer_data: { main: Record<string, unknown> } };
    // Spaces are how a number gets typed; they are not how it gets dialled.
    expect(body.customer_data.main.phone).toBe("+27825551234");
    expect(result.phone).toBe("+27825551234");
  });

  it("refuses a number that is not dialable rather than writing a dead record", async () => {
    await expect(dialOne(orgId, userId, { name: "Bad", phone: "082 555 1234" })).rejects.toThrow(
      /international form/i,
    );
    expect(writes).toHaveLength(0);
  });

  it("refuses a number on the deny list", async () => {
    process.env.JOBIX_DENY_LIST = "+27825104242";
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/deny list/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses outside calling hours, because the write is the call", async () => {
    // Sunday.
    vi.setSystemTime(new Date("2026-09-06T09:00:00Z"));
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/No calling on Sunday/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses when dialling is switched off on the deployment", async () => {
    delete process.env.JOBIX_CALLING_ENABLED;
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/switched off/i);
    expect(writes).toHaveLength(0);
  });

  it("refuses with no call flag configured, instead of writing a record nothing dials", async () => {
    await db.integrationSettings.update({
      where: { organizationId: orgId },
      data: { callFlag: null },
    });
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/No call flag/i);
    expect(writes).toHaveLength(0);
  });

  it("applies the book's own rules to a single account", async () => {
    await db.debtor.update({ where: { id: debtorId }, data: { doNotContact: true } });
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/do-not-contact/i);

    await db.debtor.update({
      where: { id: debtorId },
      data: { doNotContact: false, status: "dispute" },
    });
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/never dialled/i);

    await db.debtor.update({ where: { id: debtorId }, data: { status: "active" } });
    await db.promiseToPay.create({
      data: {
        organizationId: orgId,
        debtorId,
        amount: 500,
        promisedDate: new Date("2026-09-20"),
        status: "pending",
      },
    });
    await expect(dialOne(orgId, userId, { debtorId })).rejects.toThrow(/live promise/i);
    expect(writes).toHaveLength(0);
  });

  it("will not dial another organization's account", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-co" } });
    // Configured exactly like the first, so what refuses the call is the
    // tenant boundary and not a missing setting.
    await db.integrationSettings.create({
      data: { organizationId: other.id, provider: "jobix", callFlag: "mafadi_air" },
    });
    await expect(dialOne(other.id, userId, { debtorId })).rejects.toThrow(/not in this organization/i);
    expect(writes).toHaveLength(0);
  });

  it("leaves the placeholder dash out of the name it sends", async () => {
    // A debtor with no surname carries an em-dash in our records so lists stay
    // readable. It is a display convention, and it has no business on a wire.
    await db.debtor.update({ where: { id: debtorId }, data: { firstName: "tester", lastName: "—" } });
    await dialOne(orgId, userId, { debtorId });
    const body = writes[0].body as { customer_data: { main: Record<string, unknown> } };
    expect(body.customer_data.main.name).toBe("tester");
  });
});
