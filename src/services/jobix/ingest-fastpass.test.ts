import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// The fast pass exists so a first import is not a punishment: the call list
// and the accounts are a handful of requests, while transcripts are one per
// call. What must hold is that skipping them is HONEST — no transcript is
// fetched, and the outstanding count is recorded so the analytics screen can
// say the reach figures are a floor.
//
// The provider client is mocked; the database is real.
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const fetchTranscript = vi.hoisted(() => vi.fn());

vi.mock("./api", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./api")>();
  return {
    ...actual,
    requireWorkspace: vi.fn(async () => ({ ok: true, message: "Connected. Agents: Test." })),
    pullConversations: vi.fn(async () => ({
      conversations: Array.from({ length: 5 }, (_, i) => ({
        uuid: `conv-${i}`,
        id: i,
        channel: "voice",
        contactName: `Person ${i}`,
        contactUuid: `cust-${i}`,
        phone: `+2782000000${i}`,
        durationSeconds: 60,
        status: 1,
        conversion: false,
        voicemailFlag: false,
        actions: 0,
        createdAt: new Date("2026-08-26T09:00:00.000Z"),
        agentUuid: "agent-1",
        agentName: "Sipho",
        flowId: 1,
        flowName: "MPM Main",
      })),
      totalCount: 5,
    })),
    pullCustomers: vi.fn(async () => ({
      customers: [],
      rawCount: 0,
      droppedStale: 0,
      droppedDuplicate: 0,
    })),
    fetchTranscript,
    fetchFlowNodes: vi.fn(async () => new Map()),
    pullNodeHistory: vi.fn(async () => []),
  };
});

vi.mock("./client", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./client")>();
  return {
    ...actual,
    loadJobixEnv: () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      email: "ops@example.test",
      password: "irrelevant-in-this-test",
    }),
    // The gates resolve credentials asynchronously now, so the stub has to
    // answer that question too.
    resolveJobixEnv: async () => ({
      base: "https://example.test",
      apiBase: "https://api.example.test",
      email: "ops@example.test",
      password: "irrelevant-in-this-test",
    }),
  };
});

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("ingestion fast pass (integration)", () => {
  let orgId = "";

  beforeEach(async () => {
    vi.clearAllMocks();
    fetchTranscript.mockResolvedValue({
      turns: [{ role: "user", text: "yes I can pay on the twenty fifth" }],
      summary: { userTurns: 1, userWords: 30, userText: "yes I can pay on the twenty fifth" },
    });
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.ingestionRun.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.auditLog.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
  });

  it("stores the calls and fetches no transcripts, recording what is outstanding", async () => {
    const { runIngestion } = await import("./ingest");
    const progress = await runIngestion({ organizationId: orgId, skipTranscripts: true });

    expect(fetchTranscript).not.toHaveBeenCalled();
    expect(progress.status).toBe("completed");
    expect(progress.conversationsFound).toBe(5);
    expect(progress.transcriptsFetched).toBe(0);
    // The honesty requirement: the screen has to be able to say what is missing.
    expect(progress.transcriptsPending).toBe(5);
    expect(await db.jobixConversation.count({ where: { organizationId: orgId } })).toBe(5);
    expect(await db.jobixTranscript.count()).toBe(0);
  });

  it("a normal run afterwards fills in exactly the transcripts the fast pass left", async () => {
    const { runIngestion } = await import("./ingest");
    await runIngestion({ organizationId: orgId, skipTranscripts: true });

    const progress = await runIngestion({ organizationId: orgId });

    expect(fetchTranscript).toHaveBeenCalledTimes(5);
    expect(progress.transcriptsFetched).toBe(5);
    expect(progress.transcriptsPending).toBe(0);
    expect(await db.jobixTranscript.count()).toBe(5);
  });

  it("re-running after a full pass fetches nothing, because transcripts are cached", async () => {
    const { runIngestion } = await import("./ingest");
    await runIngestion({ organizationId: orgId });
    vi.clearAllMocks();

    const progress = await runIngestion({ organizationId: orgId });

    expect(fetchTranscript).not.toHaveBeenCalled();
    expect(progress.transcriptsCached).toBe(5);
    expect(progress.transcriptsPending).toBe(0);
  });
});
