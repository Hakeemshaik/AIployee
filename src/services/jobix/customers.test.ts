import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import type { JobixCustomer } from "./api";
import { nextStatus, persistCustomers, splitName, statedPtpDate } from "./customers";

function customer(overrides: Partial<JobixCustomer> = {}): JobixCustomer {
  return {
    id: 1,
    uuid: "cust-0001",
    phone: "+27821234567",
    name: "Sipho Nkosi",
    unit: "A4",
    building: "Rosebank Place",
    totalDue: 12500,
    ptpConfirmed: false,
    ptpAmount: null,
    disputed: false,
    paidClaimed: false,
    escalated: false,
    doNotCall: false,
    callBatch: null,
    callFlag: null,
    wrongPerson: false,
    modifiedAt: new Date("2026-08-20T08:00:00Z"),
    raw: {},
    ...overrides,
  };
}

describe("splitName", () => {
  it("splits a full name on the first space", () => {
    expect(splitName("Sipho Nkosi", "+27821234567")).toEqual({ firstName: "Sipho", lastName: "Nkosi" });
    expect(splitName("Pieter van der Merwe", "+27821234567")).toEqual({
      firstName: "Pieter",
      lastName: "van der Merwe",
    });
  });

  it("keeps a single-word name usable", () => {
    expect(splitName("Naledi", "+27821234567")).toEqual({ firstName: "Naledi", lastName: "—" });
  });

  it("labels a missing name honestly, distinguishable by phone tail", () => {
    expect(splitName(null, "+27821234567")).toEqual({ firstName: "Unknown", lastName: "(4567)" });
    expect(splitName("   ", "+27829999888")).toEqual({ firstName: "Unknown", lastName: "(9888)" });
  });
});

describe("nextStatus", () => {
  it("escalation outranks dispute outranks paid outranks promise", () => {
    expect(nextStatus("active", customer({ escalated: true, disputed: true }))).toBe("escalated");
    expect(nextStatus("active", customer({ disputed: true, paidClaimed: true }))).toBe("dispute");
    expect(nextStatus("active", customer({ paidClaimed: true, ptpConfirmed: true }))).toBe("paid");
    expect(nextStatus("active", customer({ ptpConfirmed: true }))).toBe("promise");
  });

  it("leaves the status alone when the provider has nothing to say", () => {
    expect(nextStatus("active", customer())).toBe("active");
    expect(nextStatus("uncontactable", customer())).toBe("uncontactable");
  });

  it("never overwrites a human-owned status with a flag sync", () => {
    for (const owned of ["legal", "hardship", "opted_out"]) {
      expect(nextStatus(owned, customer({ escalated: true, disputed: true, ptpConfirmed: true }))).toBe(owned);
    }
  });
});

describe("statedPtpDate", () => {
  it("reads a stated date from the raw provider fields", () => {
    expect(statedPtpDate({ ptp_date: "2026-08-25" })?.toISOString().slice(0, 10)).toBe("2026-08-25");
    expect(statedPtpDate({ promise_date: "2026-09-01" })?.toISOString().slice(0, 10)).toBe("2026-09-01");
  });

  it("refuses placeholders and garbage rather than inventing a date", () => {
    expect(statedPtpDate({})).toBeNull();
    expect(statedPtpDate({ ptp_date: "No data available" })).toBeNull();
    expect(statedPtpDate({ ptp_date: "{{ attributes.ptp_date }}" })).toBeNull();
    expect(statedPtpDate({ ptp_date: "next Tuesday-ish" })).toBeNull();
  });
});

// Opt-in, and only against a database whose name marks it as disposable —
// same guard as the data-reset tests.
const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("persistCustomers (integration)", () => {
  let orgId = "";

  beforeEach(async () => {
    await db.promiseToPay.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Sync Test Co", slug: "sync-test-co" } });
    orgId = org.id;
  });

  it("creates a debtor with a balance from a new customer record", async () => {
    const result = await persistCustomers(orgId, [customer()]);
    expect(result).toMatchObject({ created: 1, updated: 0, skippedNoPhone: 0 });

    const debtor = await db.debtor.findFirstOrThrow({ include: { accounts: true } });
    expect(debtor.firstName).toBe("Sipho");
    expect(debtor.accountNumber).toBe("JBX-cust-0001");
    expect(debtor.accounts[0].currentBalance).toBe(12500);
  });

  it("matches an existing debtor by phone in any format, and does not duplicate", async () => {
    // The CSV import stores E.164; Jobix sometimes returns local format.
    await db.debtor.create({
      data: { organizationId: orgId, firstName: "Sipho", lastName: "Nkosi", accountNumber: "ACC-77", phone: "+27821234567" },
    });
    const result = await persistCustomers(orgId, [customer({ phone: "0821234567", disputed: true })]);
    expect(result).toMatchObject({ created: 0, updated: 1 });

    const debtors = await db.debtor.findMany();
    expect(debtors).toHaveLength(1);
    expect(debtors[0].accountNumber).toBe("ACC-77"); // ledger number untouched
    expect(debtors[0].status).toBe("dispute");
  });

  it("writes a confirmed PTP as a real promise row, once", async () => {
    const record = customer({ ptpConfirmed: true, ptpAmount: 1500, raw: { ptp_date: "2026-08-29" } });
    await persistCustomers(orgId, [record]);
    // Second sync of the same record must not stack a second promise.
    const second = await persistCustomers(orgId, [record]);
    expect(second.promisesCreated).toBe(0);

    const promises = await db.promiseToPay.findMany();
    expect(promises).toHaveLength(1);
    expect(promises[0].amount).toBe(1500);
    expect(promises[0].promisedDate.toISOString().slice(0, 10)).toBe("2026-08-29");
    expect(JSON.parse(promises[0].paymentPlan!)).toMatchObject({ dateStated: true, amountStated: true });
  });

  it("keeps an unstated amount at 0 so the analytics floor/ceiling stays honest", async () => {
    await persistCustomers(orgId, [customer({ ptpConfirmed: true, ptpAmount: null })]);
    const promise = await db.promiseToPay.findFirstOrThrow();
    expect(promise.amount).toBe(0);
    expect(JSON.parse(promise.paymentPlan!)).toMatchObject({ dateStated: false, amountStated: false });
  });

  it("sets do-not-contact from the provider but never unsets it", async () => {
    const debtor = await db.debtor.create({
      data: { organizationId: orgId, firstName: "A", lastName: "B", accountNumber: "ACC-1", phone: "+27825550001", doNotContact: true },
    });
    await persistCustomers(orgId, [customer({ phone: "+27825550001", doNotCall: false })]);
    const after = await db.debtor.findUniqueOrThrow({ where: { id: debtor.id } });
    expect(after.doNotContact).toBe(true);
  });

  it("skips and counts records with an unusable phone", async () => {
    const result = await persistCustomers(orgId, [customer({ phone: "12345" })]);
    expect(result).toMatchObject({ created: 0, updated: 0, skippedNoPhone: 1 });
    expect(await db.debtor.count()).toBe(0);
  });
});
