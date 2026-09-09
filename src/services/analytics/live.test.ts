import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { buildLiveAnalytics } from "./live";

// ---------------------------------------------------------------------------
// The figures on the analytics screen are the product. These pin the rules
// that decide them:
//
//   * a call belongs to the account the provider says it belongs to — the
//     identifier wins, and a phone number is only the fallback
//   * a cancelled promise is not a commitment
//   * reach comes from the transcript, so a call without one is not reached
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("buildLiveAnalytics (integration)", () => {
  let orgId = "";

  beforeEach(async () => {
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
  });

  async function addDebtor(opts: {
    n: number;
    phone: string;
    uuid?: string | null;
    balance?: number;
  }) {
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        firstName: "Person",
        lastName: `${opts.n}`,
        accountNumber: `ACC-${opts.n}`,
        phone: opts.phone,
        providerContactUuid: opts.uuid ?? null,
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        creditorName: "Building A",
        reference: `U-${opts.n}`,
        originalBalance: opts.balance ?? 5000,
        currentBalance: opts.balance ?? 5000,
        dueDate: new Date("2026-07-01T00:00:00.000Z"),
      },
    });
    return debtor;
  }

  async function addCall(opts: {
    uuid: string;
    phone: string;
    contactUuid?: string | null;
    seconds?: number;
    transcript?: { words: number; text: string } | null;
  }) {
    const conversation = await db.jobixConversation.create({
      data: {
        organizationId: orgId,
        uuid: opts.uuid,
        phone: opts.phone,
        contactUuid: opts.contactUuid ?? null,
        durationSeconds: opts.seconds ?? 60,
        startedAt: new Date("2026-08-26T09:00:00.000Z"),
        sastHour: 11,
      },
    });
    if (opts.transcript) {
      await db.jobixTranscript.create({
        data: {
          organizationId: orgId,
          conversationId: conversation.id,
          conversationUuid: opts.uuid,
          turns: "[]",
          userTurns: 2,
          userWords: opts.transcript.words,
          userText: opts.transcript.text,
          reached: opts.transcript.words >= 15,
        },
      });
    }
  }

  const conversationText = "yes I can pay two thousand rand on the twenty fifth of next month without a problem";

  it("gives a call to the account the provider identifies, not to whoever shares the number", async () => {
    // Two accounts on the same number — the situation where a phone-only match
    // hands the same call to both and doubles the call count.
    const owner = await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addDebtor({ n: 2, phone: "+27821234567", uuid: "cust-2" });
    await addCall({ uuid: "conv-1", phone: "+27821234567", contactUuid: "cust-2", transcript: { words: 40, text: conversationText } });

    const { result, rows } = await buildLiveAnalytics(orgId);

    expect(result.analytics.calls).toBe(1);
    expect(result.analytics.accounts).toBe(2);
    const withCall = result.classified.filter((c) => c.attempts > 0);
    expect(withCall).toHaveLength(1);
    expect(withCall[0].accountId).not.toBe(owner.id);
    expect(rows).toHaveLength(2);
  });

  it("falls back to the phone number for a call with no identifier", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addCall({ uuid: "conv-1", phone: "0821234567", contactUuid: null, transcript: { words: 40, text: conversationText } });

    const { result } = await buildLiveAnalytics(orgId);

    expect(result.analytics.calls).toBe(1);
    expect(result.analytics.reachedAccounts).toBe(1);
  });

  it("counts a call once when both an identifier and a matching number exist", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addCall({ uuid: "conv-1", phone: "+27821234567", contactUuid: "cust-1", transcript: { words: 40, text: conversationText } });

    const { result } = await buildLiveAnalytics(orgId);

    expect(result.analytics.calls).toBe(1);
  });

  it("does not count a cancelled promise as a commitment", async () => {
    const debtor = await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addCall({ uuid: "conv-1", phone: "+27821234567", contactUuid: "cust-1", transcript: { words: 40, text: conversationText } });
    await db.promiseToPay.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        amount: 9999,
        promisedDate: new Date("2026-09-09T00:00:00.000Z"),
        status: "cancelled",
      },
    });

    const { result } = await buildLiveAnalytics(orgId);

    expect(result.analytics.commitments.count).toBe(0);
    expect(result.analytics.ptpRate).toBe(0);
  });

  it("counts a broken promise as a commitment that was made", async () => {
    const debtor = await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addCall({ uuid: "conv-1", phone: "+27821234567", contactUuid: "cust-1", transcript: { words: 40, text: conversationText } });
    await db.promiseToPay.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        amount: 1500,
        promisedDate: new Date("2026-08-01T00:00:00.000Z"),
        status: "broken",
      },
    });

    const { result } = await buildLiveAnalytics(orgId);

    expect(result.analytics.commitments.count).toBe(1);
  });

  it("treats a call with no transcript as not reached, and reports the gap", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    await addCall({ uuid: "conv-1", phone: "+27821234567", contactUuid: "cust-1", seconds: 45, transcript: null });

    const { result, callsTotal, callsWithTranscript, transcriptCoverage } = await buildLiveAnalytics(orgId);

    expect(result.analytics.reachedAccounts).toBe(0);
    expect(callsTotal).toBe(1);
    expect(callsWithTranscript).toBe(0);
    expect(transcriptCoverage).toBe(0);
  });

  it("never counts another organization's calls", async () => {
    await addDebtor({ n: 1, phone: "+27821234567", uuid: "cust-1" });
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    await db.jobixConversation.create({
      data: {
        organizationId: other.id,
        uuid: "theirs",
        phone: "+27821234567",
        contactUuid: "cust-1",
        durationSeconds: 90,
        startedAt: new Date("2026-08-26T09:00:00.000Z"),
        sastHour: 11,
      },
    });

    const { result } = await buildLiveAnalytics(orgId);

    expect(result.analytics.calls).toBe(0);
  });
});
