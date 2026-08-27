import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { reconcileStalledRun, STALE_RUN_MS, syncConversations } from "./ingest";
import type { JobixConversation } from "./api";

// ---------------------------------------------------------------------------
// These cover the two ways a large pull used to go wrong, both of which need a
// real database to be meaningful:
//
//   * a row per conversation per round trip spent the request budget writing
//     rows that had not changed
//   * a run killed at the duration ceiling stayed "running" for ever, so the
//     panel spun and the operator could not continue
//
// Opt-in and scratch-only, like the other integration suites:
//
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
// ---------------------------------------------------------------------------

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

function conversation(index: number, overrides: Partial<JobixConversation> = {}): JobixConversation {
  return {
    uuid: `uuid-${index}`,
    id: index,
    channel: "voice",
    contactUuid: `contact-${index}`,
    actions: 0,
    flowId: 1,
    phone: `+2782000${String(index).padStart(4, "0")}`,
    contactName: `Debtor ${index}`,
    agentUuid: "agent-1",
    agentName: "Sipho",
    flowName: "MPM Main",
    durationSeconds: 30,
    status: 1,
    conversion: false,
    voicemailFlag: false,
    createdAt: new Date("2026-08-25T09:00:00.000Z"),
    ...overrides,
  };
}

describe.skipIf(!scratch)("syncConversations (integration)", () => {
  let orgId = "";

  beforeEach(async () => {
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.ingestionRun.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
  });

  it("writes every new conversation and returns an id for each", async () => {
    const rows = Array.from({ length: 25 }, (_, i) => conversation(i));
    const ids = await syncConversations(orgId, rows);

    expect(ids.size).toBe(25);
    expect(await db.jobixConversation.count({ where: { organizationId: orgId } })).toBe(25);
    for (const row of rows) expect(ids.get(row.uuid)).toBeTruthy();
  });

  it("is idempotent: a second pass creates nothing and keeps the same ids", async () => {
    const rows = Array.from({ length: 10 }, (_, i) => conversation(i));
    const first = await syncConversations(orgId, rows);
    const second = await syncConversations(orgId, rows);

    expect(await db.jobixConversation.count({ where: { organizationId: orgId } })).toBe(10);
    for (const row of rows) expect(second.get(row.uuid)).toBe(first.get(row.uuid));
  });

  it("writes a changed outcome onto an existing row", async () => {
    await syncConversations(orgId, [conversation(1)]);
    await syncConversations(orgId, [
      conversation(1, { status: 3, durationSeconds: 96, conversion: true, voicemailFlag: true }),
    ]);

    const stored = await db.jobixConversation.findFirstOrThrow({
      where: { organizationId: orgId, uuid: "uuid-1" },
    });
    expect(stored.status).toBe(3);
    expect(stored.durationSeconds).toBe(96);
    expect(stored.conversion).toBe(true);
    expect(stored.voicemailFlag).toBe(true);
  });

  it("keeps each organization's conversations separate", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    await syncConversations(orgId, [conversation(1)]);
    await syncConversations(other.id, [conversation(1)]);

    expect(await db.jobixConversation.count({ where: { organizationId: orgId } })).toBe(1);
    expect(await db.jobixConversation.count({ where: { organizationId: other.id } })).toBe(1);
  });
});

describe.skipIf(!scratch)("reconcileStalledRun (integration)", () => {
  let orgId = "";

  beforeEach(async () => {
    await db.ingestionRun.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch" } });
    orgId = org.id;
  });

  /** Push a run's last checkpoint into the past. @updatedAt would overwrite a
   *  value passed through the client, so this goes around it. */
  async function ageRun(id: string, ms: number) {
    await db.$executeRaw`UPDATE "IngestionRun" SET "updatedAt" = NOW() - (${ms}::text || ' milliseconds')::interval WHERE "id" = ${id}`;
  }

  it("marks a run whose process died as interrupted, not running", async () => {
    const run = await db.ingestionRun.create({
      data: { organizationId: orgId, status: "running", phase: "transcripts" },
    });
    await ageRun(run.id, STALE_RUN_MS + 60_000);

    await reconcileStalledRun(orgId);

    const after = await db.ingestionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("interrupted");
    expect(after.finishedAt).not.toBeNull();
    expect(after.error).toMatch(/time limit/i);
    // Interrupted is resumable, so the phase reached must be preserved.
    expect(after.phase).toBe("transcripts");
  });

  it("leaves a run that is still checkpointing alone", async () => {
    const run = await db.ingestionRun.create({
      data: { organizationId: orgId, status: "running", phase: "conversations" },
    });

    await reconcileStalledRun(orgId);

    const after = await db.ingestionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("running");
    expect(after.finishedAt).toBeNull();
  });

  it("never rewrites a finished run", async () => {
    const run = await db.ingestionRun.create({
      data: {
        organizationId: orgId,
        status: "completed",
        phase: "done",
        finishedAt: new Date("2026-08-26T10:00:00.000Z"),
      },
    });
    await ageRun(run.id, STALE_RUN_MS * 10);

    await reconcileStalledRun(orgId);

    const after = await db.ingestionRun.findUniqueOrThrow({ where: { id: run.id } });
    expect(after.status).toBe("completed");
    expect(after.error).toBeNull();
  });

  it("does not touch another organization's stalled run", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other" } });
    const mine = await db.ingestionRun.create({
      data: { organizationId: orgId, status: "running", phase: "transcripts" },
    });
    const theirs = await db.ingestionRun.create({
      data: { organizationId: other.id, status: "running", phase: "transcripts" },
    });
    await ageRun(mine.id, STALE_RUN_MS + 1000);
    await ageRun(theirs.id, STALE_RUN_MS + 1000);

    await reconcileStalledRun(orgId);

    expect((await db.ingestionRun.findUniqueOrThrow({ where: { id: mine.id } })).status).toBe("interrupted");
    expect((await db.ingestionRun.findUniqueOrThrow({ where: { id: theirs.id } })).status).toBe("running");
  });
});
