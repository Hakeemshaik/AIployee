import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Going to get the result.
//
// The webhook is the better mechanism, but it has to be configured on the flow,
// and until it is the conversation and its transcript are sitting on the
// platform being ignored. This reads them.
//
// The join is weaker than the webhook's — a number and a time, not a reference
// — so what is asserted here is mostly about not being wrong: a call that
// happened BEFORE the dial is not this dial's, and a few seconds of ringing
// into nothing is not somebody answering.
// ---------------------------------------------------------------------------

const pullConversations = vi.hoisted(() => vi.fn());
const fetchTranscript = vi.hoisted(() => vi.fn());

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
    JobixClient: class {},
  };
});

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return { ...actual, pullConversations, fetchTranscript };
});

const { fetchDialOutcome } = await import("./fetch-outcome");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

const PLACED_AT = new Date("2026-09-01T09:00:00Z");

function conversation(overrides: Record<string, unknown> = {}) {
  return {
    id: 1,
    uuid: "conv-1",
    channel: "voice",
    contactName: "Hakeem Shaik",
    contactUuid: "cust-1",
    phone: "+27825104242",
    durationSeconds: 94,
    status: 1,
    conversion: false,
    voicemailFlag: false,
    actions: 0,
    createdAt: new Date(PLACED_AT.getTime() + 30_000),
    agentUuid: "agent-1",
    agentName: "Siya",
    flowId: 1,
    flowName: "Collections",
    ...overrides,
  };
}

describe.skipIf(!scratch)("fetching a dial's result off the platform", () => {
  let orgId = "";
  let attemptId = "";

  beforeEach(async () => {
    pullConversations.mockReset();
    fetchTranscript.mockReset();
    fetchTranscript.mockResolvedValue({
      turns: [
        { role: "assistant", text: "Your account is R1 086 in arrears." },
        { role: "user", text: "I will pay R1 086 on the 20th." },
      ],
      summary: {},
    });

    await db.callAnalysis.deleteMany();
    await db.promiseToPay.deleteMany();
    await db.call.deleteMany();
    await db.dialAttempt.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Pull Co", slug: "pull-co" } });
    orgId = org.id;
    const debtor = await db.debtor.create({
      data: {
        organizationId: orgId,
        firstName: "Hakeem",
        lastName: "Shaik",
        accountNumber: "PULL-1",
        phone: "+27825104242",
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId: orgId,
        debtorId: debtor.id,
        reference: "PULL-1",
        creditorName: "Mafadi",
        originalBalance: 1086,
        currentBalance: 1086,
        dueDate: new Date("2026-08-01"),
        daysOverdue: 31,
      },
    });
    attemptId = (
      await db.dialAttempt.create({
        data: {
          organizationId: orgId,
          suid: "aaaaaaaa-1111-4111-8111-111111111111",
          debtorId: debtor.id,
          name: "Hakeem Shaik",
          phone: "+27825104242",
          callFlag: "mafadi_air",
          state: "placed",
          requestedAt: PLACED_AT,
        },
      })
    ).id;
  });

  it("reads the conversation and puts it through the same path the webhook uses", async () => {
    pullConversations.mockResolvedValue({ conversations: [conversation()], totalCount: 1 });

    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result).toMatchObject({ found: true, state: "reached", conversationUuid: "conv-1" });

    const attempt = await db.dialAttempt.findFirstOrThrow({ where: { id: attemptId } });
    expect(attempt.state).toBe("reached");
    expect(attempt.durationSeconds).toBe(94);
    expect(attempt.transcript).toContain("Customer: I will pay R1 086 on the 20th.");
    // Everything downstream of a call still happens: a call row, an analysis,
    // and the promise the conversation captured.
    expect(await db.call.count()).toBe(1);
    expect(await db.promiseToPay.count()).toBe(1);
  });

  it("only looks at the number this dial rang", async () => {
    pullConversations.mockResolvedValue({ conversations: [], totalCount: 0 });
    await fetchDialOutcome(orgId, attemptId);
    expect(pullConversations.mock.calls[0][1]).toMatchObject({
      filters: { phone: "+27825104242" },
    });
  });

  it("does not claim a call that happened before the dial was placed", async () => {
    pullConversations.mockResolvedValue({
      conversations: [conversation({ createdAt: new Date(PLACED_AT.getTime() - 10 * 60_000) })],
      totalCount: 1,
    });
    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result.found).toBe(false);
    expect((await db.dialAttempt.findFirstOrThrow({ where: { id: attemptId } })).state).toBe("placed");
  });

  it("takes the first call after the dial when the number was rung twice", async () => {
    pullConversations.mockResolvedValue({
      conversations: [
        conversation({ uuid: "later", createdAt: new Date(PLACED_AT.getTime() + 400_000) }),
        conversation({ uuid: "first", createdAt: new Date(PLACED_AT.getTime() + 20_000) }),
      ],
      totalCount: 2,
    });
    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result).toMatchObject({ conversationUuid: "first" });
  });

  it("counts a few seconds of ringing into nothing as nobody answering", async () => {
    pullConversations.mockResolvedValue({
      conversations: [conversation({ durationSeconds: 4 })],
      totalCount: 1,
    });
    fetchTranscript.mockResolvedValue({ turns: [], summary: {} });

    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result).toMatchObject({ state: "no_answer" });
    // No conversation happened, so no call, no analysis and no promise.
    expect(await db.call.count()).toBe(0);
  });

  it("still records the call when the transcript cannot be read", async () => {
    pullConversations.mockResolvedValue({ conversations: [conversation()], totalCount: 1 });
    fetchTranscript.mockRejectedValue(new Error("422"));

    const result = await fetchDialOutcome(orgId, attemptId);
    // One turn is not a conversation, so this is honestly a no-answer rather
    // than a reach with no words in it.
    expect(result.found).toBe(true);
    expect((await db.dialAttempt.findFirstOrThrow({ where: { id: attemptId } })).state).toBe(
      "no_answer",
    );
  });

  it("says nothing is there yet rather than inventing a result", async () => {
    pullConversations.mockResolvedValue({ conversations: [], totalCount: 0 });
    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result.found).toBe(false);
    if (!result.found) expect(result.reason).toMatch(/no conversation/i);
  });

  it("leaves a dial the webhook already answered alone", async () => {
    await db.dialAttempt.update({
      where: { id: attemptId },
      data: { state: "reached", callId: "call-from-webhook" },
    });
    const result = await fetchDialOutcome(orgId, attemptId);
    expect(result).toMatchObject({ found: true, state: "reached" });
    expect(pullConversations).not.toHaveBeenCalled();
  });
});
