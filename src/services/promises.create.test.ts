import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { createPromise } from "./promises";

// ---------------------------------------------------------------------------
// Writing down a commitment by hand.
//
// A promise is the most valuable record this business keeps and the one that
// stops an account being dialled, so the rules worth holding are about not
// creating a wrong one: no second live promise on an account, no date in the
// past, and never somebody else's debtor.
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

function inDays(days: number): Date {
  const date = new Date();
  date.setDate(date.getDate() + days);
  return date;
}

describe.skipIf(!scratch)("capturing a promise by hand", () => {
  let orgId = "";
  let userId = "";
  let debtorId = "";

  beforeEach(async () => {
    await db.promiseToPay.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Promise Co", slug: "promise-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: {
          organizationId: orgId,
          name: "Thandi Mokoena",
          email: "thandi@promise.test",
          role: "collector",
        },
      })
    ).id;
    debtorId = (
      await db.debtor.create({
        data: {
          organizationId: orgId,
          firstName: "Sipho",
          lastName: "Ndlovu",
          accountNumber: "PROM-1",
          phone: "+27825551234",
          status: "active",
        },
      })
    ).id;
  });

  it("records the amount, the date, how they are paying and from where", async () => {
    const promise = await createPromise(orgId, userId, {
      debtorId,
      amount: 1650,
      promisedDate: inDays(7),
      method: "debit_order",
      bank: "Capitec",
      note: "After the medical aid refund clears",
    });

    expect(promise).toMatchObject({ amount: 1650, method: "debit_order", bank: "Capitec" });
    expect(JSON.parse(promise.paymentPlan!)).toEqual({
      note: "After the medical aid refund clears",
    });
  });

  it("stops the account being dialled", async () => {
    await createPromise(orgId, userId, { debtorId, amount: 500, promisedDate: inDays(3) });
    const debtor = await db.debtor.findFirstOrThrow({ where: { id: debtorId } });
    // The dialling guard reads the status, so a promise that does not move it
    // is a promise the dialler will ignore.
    expect(debtor.status).toBe("promise");
  });

  it("refuses a second live promise on the same account", async () => {
    await createPromise(orgId, userId, { debtorId, amount: 500, promisedDate: inDays(3) });
    await expect(
      createPromise(orgId, userId, { debtorId, amount: 900, promisedDate: inDays(10) }),
    ).rejects.toThrow(/already has an open promise/i);
    expect(await db.promiseToPay.count()).toBe(1);
  });

  it("allows a new promise once the last one is settled", async () => {
    const first = await createPromise(orgId, userId, {
      debtorId,
      amount: 500,
      promisedDate: inDays(3),
    });
    await db.promiseToPay.update({ where: { id: first.id }, data: { status: "fulfilled" } });
    await expect(
      createPromise(orgId, userId, { debtorId, amount: 900, promisedDate: inDays(10) }),
    ).resolves.toBeTruthy();
  });

  it("refuses a date that has already gone", async () => {
    await expect(
      createPromise(orgId, userId, { debtorId, amount: 500, promisedDate: inDays(-1) }),
    ).rejects.toThrow(/past/i);
  });

  it("takes today, because a promise made this morning is often for this afternoon", async () => {
    await expect(
      createPromise(orgId, userId, { debtorId, amount: 500, promisedDate: new Date() }),
    ).resolves.toBeTruthy();
  });

  it("refuses a date so far out it is not a promise", async () => {
    await expect(
      createPromise(orgId, userId, { debtorId, amount: 500, promisedDate: inDays(400) }),
    ).rejects.toThrow(/year/i);
  });

  it("will not write a promise against another organization's debtor", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-promise" } });
    const theirs = await db.debtor.create({
      data: {
        organizationId: other.id,
        firstName: "Someone",
        lastName: "Else",
        accountNumber: "OTHER-1",
        phone: "+27835550000",
      },
    });
    await expect(
      createPromise(orgId, userId, { debtorId: theirs.id, amount: 500, promisedDate: inDays(3) }),
    ).rejects.toThrow(/not found/i);
    expect(await db.promiseToPay.count()).toBe(0);
  });

  it("refuses an amount that is not money owed", async () => {
    for (const amount of [0, -100]) {
      await expect(
        createPromise(orgId, userId, { debtorId, amount, promisedDate: inDays(3) }),
      ).rejects.toThrow();
    }
  });
});
