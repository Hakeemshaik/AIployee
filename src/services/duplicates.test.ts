import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { findDuplicates, mergeDuplicates } from "./duplicates";

// ---------------------------------------------------------------------------
// A merge deletes rows, so its invariants are tested against a real database.
// The two that matter: nothing is discarded — every account, call, promise and
// payment survives on the keeper — and the matching never reaches beyond the
// organization or guesses from a name.
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("duplicate accounts (integration)", () => {
  let orgId = "";
  let userId = "";

  beforeEach(async () => {
    await db.payment.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.escalation.deleteMany();
    await db.campaignContact.deleteMany();
    await db.call.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "ops@example.com", role: "admin" },
      })
    ).id;
  });

  async function addDebtor(opts: {
    n: number;
    phone: string;
    uuid?: string | null;
    balance?: number;
    org?: string;
  }) {
    const debtor = await db.debtor.create({
      data: {
        organizationId: opts.org ?? orgId,
        firstName: "Person",
        lastName: `${opts.n}`,
        accountNumber: `ACC-${opts.n}`,
        phone: opts.phone,
        providerContactUuid: opts.uuid ?? null,
      },
    });
    if (opts.balance !== undefined) {
      await db.debtAccount.create({
        data: {
          organizationId: opts.org ?? orgId,
          debtorId: debtor.id,
          creditorName: "Building A",
          reference: `U-${opts.n}`,
          originalBalance: opts.balance,
          currentBalance: opts.balance,
          dueDate: new Date("2026-07-01T00:00:00.000Z"),
        },
      });
    }
    return debtor;
  }

  it("finds two records with the same number and says what the book is overstated by", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", balance: 5000 });
    await addDebtor({ n: 2, phone: "0821234567", balance: 3000 });
    await addDebtor({ n: 3, phone: "+27829999999", balance: 1000 });

    const report = await findDuplicates(orgId);

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].matchedOn).toBe("phone");
    expect(report.groups[0].members).toHaveLength(2);
    expect(report.extraRecords).toBe(1);
    // Only the non-keeper's balance is double counted.
    expect(report.overstatedValue).toBeGreaterThan(0);
    expect(report.scanned).toBe(3);
  });

  it("prefers the record the voice platform writes to as the keeper", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", balance: 5000 });
    const withUuid = await addDebtor({ n: 2, phone: "+27821234567", uuid: "cust-1", balance: 3000 });

    const report = await findDuplicates(orgId);
    const keeper = report.groups[0].members.find((m) => m.keeper);

    expect(keeper?.debtorId).toBe(withUuid.id);
  });

  it("groups on the provider identifier even when the numbers differ", async () => {
    await addDebtor({ n: 1, phone: "+27821111111", uuid: "cust-9", balance: 5000 });
    await addDebtor({ n: 2, phone: "+27822222222", uuid: "cust-9", balance: 2000 });

    const report = await findDuplicates(orgId);

    expect(report.groups).toHaveLength(1);
    expect(report.groups[0].matchedOn).toBe("provider_uuid");
  });

  it("never groups on name similarity alone", async () => {
    // Same surname, different numbers: different tenants, and merging them
    // would lose a real account.
    await db.debtor.create({
      data: { organizationId: orgId, firstName: "J", lastName: "Smith", accountNumber: "A-1", phone: "+27821111111" },
    });
    await db.debtor.create({
      data: { organizationId: orgId, firstName: "John", lastName: "Smith", accountNumber: "A-2", phone: "+27822222222" },
    });

    expect((await findDuplicates(orgId)).groups).toHaveLength(0);
  });

  it("moves every account, call, promise and payment onto the keeper, then deletes the duplicate", async () => {
    const keep = await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1", balance: 5000 });
    const dupe = await addDebtor({ n: 2, phone: "+27821234567", balance: 3000 });
    await db.call.create({
      data: {
        organizationId: orgId,
        debtorId: dupe.id,
        status: "completed",
        startedAt: new Date("2026-08-20T09:00:00.000Z"),
      },
    });
    await db.promiseToPay.create({
      data: {
        organizationId: orgId,
        debtorId: dupe.id,
        amount: 1500,
        promisedDate: new Date("2026-09-01T00:00:00.000Z"),
      },
    });
    await db.payment.create({
      data: {
        organizationId: orgId,
        debtorId: dupe.id,
        amount: 500,
        status: "completed",
        paidAt: new Date("2026-08-21T09:00:00.000Z"),
        method: "eft",
      },
    });

    const report = await findDuplicates(orgId);
    const result = await mergeDuplicates(orgId, userId, [report.groups[0].key]);

    expect(result).toMatchObject({ groupsMerged: 1, recordsRemoved: 1 });
    expect(await db.debtor.count()).toBe(1);
    const survivor = await db.debtor.findUniqueOrThrow({
      where: { id: keep.id },
      include: { accounts: true, calls: true, promises: true, payments: true },
    });
    // Nothing was discarded: both accounts, and every child row, moved across.
    expect(survivor.accounts).toHaveLength(2);
    expect(survivor.calls).toHaveLength(1);
    expect(survivor.promises).toHaveLength(1);
    expect(survivor.payments).toHaveLength(1);
  });

  it("merges only the groups it was given", async () => {
    await addDebtor({ n: 1, phone: "+27821111111", balance: 100 });
    await addDebtor({ n: 2, phone: "+27821111111", balance: 100 });
    await addDebtor({ n: 3, phone: "+27822222222", balance: 100 });
    await addDebtor({ n: 4, phone: "+27822222222", balance: 100 });

    const report = await findDuplicates(orgId);
    expect(report.groups).toHaveLength(2);

    await mergeDuplicates(orgId, userId, [report.groups[0].key]);

    expect(await db.debtor.count()).toBe(3);
    expect((await findDuplicates(orgId)).groups).toHaveLength(1);
  });

  it("never touches another organization's records", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    await addDebtor({ n: 1, phone: "+27821234567", balance: 100 });
    await addDebtor({ n: 2, phone: "+27821234567", balance: 100 });
    // The same number in another tenant is a different person entirely.
    await addDebtor({ n: 3, phone: "+27821234567", balance: 100, org: other.id });

    const report = await findDuplicates(orgId);
    expect(report.groups[0].members).toHaveLength(2);
    expect(report.scanned).toBe(2);

    await mergeDuplicates(orgId, userId, [report.groups[0].key]);

    expect(await db.debtor.count({ where: { organizationId: other.id } })).toBe(1);
  });

  it("ignores a group key that does not belong to this organization", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    await addDebtor({ n: 1, phone: "+27829999999", balance: 100, org: other.id });
    await addDebtor({ n: 2, phone: "+27829999999", balance: 100, org: other.id });
    const theirs = await findDuplicates(other.id);

    // Their group key, submitted against our organization.
    const result = await mergeDuplicates(orgId, userId, [theirs.groups[0].key]);

    expect(result.groupsMerged).toBe(0);
    expect(await db.debtor.count({ where: { organizationId: other.id } })).toBe(2);
  });
});
