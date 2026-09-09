import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { flattenTranscript, recordDialOutcome, statedOutcome } from "./dial-outcome";

// ---------------------------------------------------------------------------
// What happened on the call, coming back.
//
// The join is the suid this platform minted for the write that placed the call.
// Everything here is about that join holding: a result finds its attempt, an
// attempt against an account goes through the same pipeline every other call
// does (so a promise to pay becomes a promise row), a retry does not create a
// second one, and a suid from another organization finds nothing.
// ---------------------------------------------------------------------------

describe("reading a transcript off the wire", () => {
  it("turns turns into something a person reads", () => {
    expect(
      flattenTranscript([
        { role: "assistant", text: "Hi, is this Thabo?" },
        { role: "user", text: "Speaking." },
      ]),
    ).toBe("Agent: Hi, is this Thabo?\nCustomer: Speaking.");
  });

  it("takes a plain block as it is", () => {
    expect(flattenTranscript("Agent: hello\nCustomer: hi")).toBe("Agent: hello\nCustomer: hi");
  });

  it("is undefined when there is nothing to read, not an empty string", () => {
    expect(flattenTranscript(undefined)).toBeUndefined();
    expect(flattenTranscript("   ")).toBeUndefined();
    expect(flattenTranscript([])).toBeUndefined();
  });
});

describe("an outcome the flow states itself", () => {
  it("takes one of ours, under any of the names a flow uses for it", () => {
    expect(statedOutcome({ outcome: "promise_to_pay" })).toBe("promise_to_pay");
    expect(statedOutcome({ calloutcome_tag: "Promise To Pay" })).toBe("promise_to_pay");
    expect(statedOutcome({ lead_status: "wrong-number" })).toBe("wrong_number");
  });

  it("ignores anything that is not, and leaves it to the classifier", () => {
    expect(statedOutcome({ outcome: "vibes" })).toBeUndefined();
    expect(statedOutcome({ outcome: 7 })).toBeUndefined();
    expect(statedOutcome(undefined)).toBeUndefined();
  });
});

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("recording a dial outcome (integration)", () => {
  let orgId = "";
  let debtorId = "";
  let suid = "";

  beforeEach(async () => {
    await db.callAnalysis.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.call.deleteMany();
    await db.dialAttempt.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Dial Co", slug: "dial-outcome-co" } });
    orgId = org.id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        firstName: "Hakeem",
        lastName: "Shaik",
        accountNumber: "OUT-1",
        phone: "+27825104242",
      },
    });
    debtorId = debtor.id;
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId,
        reference: "OUT-1",
        creditorName: "Mafadi",
        originalBalance: 4000,
        currentBalance: 4000,
        dueDate: new Date("2026-07-01"),
        daysOverdue: 62,
      },
    });
    suid = "11111111-2222-4333-8444-555555555555";
    await db.dialAttempt.create({
      data: {
        organizationId: orgId,
        suid,
        debtorId,
        name: "Hakeem Shaik",
        phone: "+27825104242",
        callFlag: "mafadi_air",
        state: "placed",
      },
    });
  });

  it("saves the call, the transcript and the promise it captured", async () => {
    const result = await recordDialOutcome(orgId, "key-1", {
      suid,
      status: "answered",
      event_id: "jobix-call-1",
      duration_seconds: 96,
      recording_url: "https://recordings.example.com/1.mp3",
      transcript: [
        { role: "assistant", text: "Your account is R4 000 in arrears. Can you settle it?" },
        { role: "user", text: "I can pay R1 500 on the 20th of September." },
      ],
    });

    expect(result.state).toBe("reached");
    expect(result.callId).toBeTruthy();

    const attempt = await db.dialAttempt.findFirstOrThrow({ where: { organizationId: orgId, suid } });
    expect(attempt.state).toBe("reached");
    expect(attempt.durationSeconds).toBe(96);
    expect(attempt.recordingUrl).toBe("https://recordings.example.com/1.mp3");
    expect(attempt.transcript).toContain("Agent: Your account is R4 000 in arrears");
    expect(attempt.transcript).toContain("Customer: I can pay R1 500");
    // The raw body is kept, because a mapping that turns out wrong has to be
    // fixable without asking the platform to send it all again.
    expect(attempt.raw).toContain("jobix-call-1");

    // Through the same pipeline as any other call: a call row, an analysis,
    // and — the whole point of ringing anybody — a promise to pay.
    const call = await db.call.findFirstOrThrow({ where: { organizationId: orgId } });
    expect(call.debtorId).toBe(debtorId);
    expect(call.externalCallId).toBe("jobix-call-1");
    const analysis = await db.callAnalysis.findFirst({ where: { callId: call.id } });
    expect(analysis).not.toBeNull();
    const promise = await db.promiseToPay.findFirst({ where: { organizationId: orgId } });
    expect(promise?.amount).toBeGreaterThan(0);
    expect(attempt.outcome).toBe("promise_to_pay");
  });

  it("records nobody answering without inventing a call", async () => {
    const result = await recordDialOutcome(orgId, "key-1", { suid, status: "no_answer" });
    expect(result.state).toBe("no_answer");
    expect(result.callId).toBeNull();
    expect(await db.call.count()).toBe(0);
    const attempt = await db.dialAttempt.findFirstOrThrow({ where: { suid } });
    expect(attempt.state).toBe("no_answer");
    expect(attempt.endedAt).not.toBeNull();
  });

  it("maps voicemail and a failure to something a person understands", async () => {
    await recordDialOutcome(orgId, "key-1", { suid, status: "voicemail" });
    expect((await db.dialAttempt.findFirstOrThrow({ where: { suid } })).state).toBe("no_answer");

    await db.dialAttempt.update({ where: { id: (await db.dialAttempt.findFirstOrThrow({ where: { suid } })).id }, data: { state: "placed", callId: null } });
    await recordDialOutcome(orgId, "key-1", { suid, status: "error" });
    expect((await db.dialAttempt.findFirstOrThrow({ where: { suid } })).state).toBe("failed");
  });

  it("does not make a second call, promise or escalation when the platform retries", async () => {
    const body = {
      suid,
      status: "answered",
      event_id: "jobix-call-2",
      transcript: "Agent: hello\nCustomer: I will pay R900 on 12 September.",
    };
    const first = await recordDialOutcome(orgId, "key-1", body);
    const second = await recordDialOutcome(orgId, "key-1", body);

    expect(second.duplicate).toBe(true);
    expect(second.callId).toBe(first.callId);
    expect(await db.call.count()).toBe(1);
    expect(await db.promiseToPay.count()).toBeLessThanOrEqual(1);
  });

  it("refuses a reference that was never dialled from here", async () => {
    await expect(
      recordDialOutcome(orgId, "key-1", { suid: "not-a-dial", status: "answered" }),
    ).rejects.toThrow(/never dialled|No dial/i);
  });

  it("will not let one organization's outcome land on another's dial", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-dial-co" } });
    await expect(recordDialOutcome(other.id, "key-2", { suid, status: "answered" })).rejects.toThrow(
      /No dial/i,
    );
    expect((await db.dialAttempt.findFirstOrThrow({ where: { suid } })).state).toBe("placed");
  });

  it("keeps a hand-dialled number's result without inventing an account for it", async () => {
    const loose = "99999999-2222-4333-8444-555555555555";
    await db.dialAttempt.create({
      data: {
        organizationId: orgId,
        suid: loose,
        name: "Test Line",
        phone: "+27000000001",
        callFlag: "mafadi_air",
        state: "placed",
      },
    });
    const result = await recordDialOutcome(orgId, "key-1", {
      suid: loose,
      status: "answered",
      transcript: "Agent: hello\nCustomer: hello",
    });
    expect(result.state).toBe("reached");
    expect(result.callId).toBeNull();
    expect(await db.call.count()).toBe(0);
    const attempt = await db.dialAttempt.findFirstOrThrow({ where: { suid: loose } });
    expect(attempt.transcript).toContain("Customer: hello");
  });
});
