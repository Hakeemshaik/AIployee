import { beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Filling in calls nobody watched.
//
// What is asserted here is restraint. The sweep talks to somebody else's rate
// limit on a schedule, with no person watching it, so the rules that matter are
// the ones about NOT asking: not about a call that has not finished, not more
// than the budget in one run, and never guessing at a result it could not get.
// ---------------------------------------------------------------------------

const fetchDialOutcome = vi.hoisted(() => vi.fn());

vi.mock("./fetch-outcome", () => ({ fetchDialOutcome }));

const { sweepDialOutcomes } = await import("./sweep-outcomes");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

const NOW = new Date("2026-09-01T12:00:00Z");
const minutesAgo = (n: number) => new Date(NOW.getTime() - n * 60_000);

describe.skipIf(!scratch)("sweeping for call results", () => {
  let orgId = "";

  async function placeDial(suid: string, requestedAt: Date) {
    return db.dialAttempt.create({
      data: {
        organizationId: orgId,
        suid,
        name: "Hakeem Shaik",
        phone: "+27825104242",
        callFlag: "mafadi_air",
        state: "placed",
        requestedAt,
      },
    });
  }

  beforeEach(async () => {
    fetchDialOutcome.mockReset();
    fetchDialOutcome.mockResolvedValue({ found: true, state: "reached", conversationUuid: "c1" });

    await db.dialAttempt.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Sweep Co", slug: "sweep-co" } });
    orgId = org.id;
  });

  it("leaves a call that has only just been placed alone", async () => {
    await placeDial("just-now", minutesAgo(1));
    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result.considered).toBe(0);
    expect(fetchDialOutcome).not.toHaveBeenCalled();
  });

  it("asks about a call old enough to have finished", async () => {
    const dial = await placeDial("settled", minutesAgo(5));
    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result).toMatchObject({ considered: 1, filled: 1, remaining: 0 });
    expect(fetchDialOutcome).toHaveBeenCalledWith(orgId, dial.id);
  });

  it("works the oldest first and leaves the rest for the next run", async () => {
    const oldest = await placeDial("a", minutesAgo(30));
    const middle = await placeDial("b", minutesAgo(20));
    await placeDial("c", minutesAgo(10));

    const result = await sweepDialOutcomes(orgId, { now: NOW, budget: 2 });
    expect(result).toMatchObject({ considered: 3, filled: 2, remaining: 1 });
    expect(fetchDialOutcome.mock.calls.map((call) => call[1])).toEqual([oldest.id, middle.id]);
  });

  it("gives up on a dial too old to match safely, and says that is what happened", async () => {
    const stale = await placeDial("ancient", minutesAgo(4 * 24 * 60));
    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result).toMatchObject({ abandoned: 1, filled: 0 });
    expect(fetchDialOutcome).not.toHaveBeenCalled();

    const row = await db.dialAttempt.findFirstOrThrow({ where: { id: stale.id } });
    // Not "no answer" — nobody knows whether it was answered. The record says
    // the result never arrived, which is the only true thing available.
    expect(row.state).toBe("failed");
    expect(row.outcome).toBe("no_outcome_reported");
  });

  it("leaves a dial the platform has nothing for yet open, to try again", async () => {
    const dial = await placeDial("pending", minutesAgo(5));
    fetchDialOutcome.mockResolvedValue({ found: false, reason: "no conversation yet", scanned: 0 });

    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result).toMatchObject({ pending: 1, filled: 0 });
    expect((await db.dialAttempt.findFirstOrThrow({ where: { id: dial.id } })).state).toBe("placed");
  });

  it("carries on past one dial that could not be read", async () => {
    await placeDial("bad", minutesAgo(30));
    await placeDial("good", minutesAgo(20));
    fetchDialOutcome
      .mockRejectedValueOnce(new Error("502"))
      .mockResolvedValueOnce({ found: true, state: "reached", conversationUuid: "c2" });

    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result).toMatchObject({ failed: 1, filled: 1 });
  });

  it("never touches another organization's dials", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-co" } });
    await db.dialAttempt.create({
      data: {
        organizationId: other.id,
        suid: "theirs",
        name: "Someone Else",
        phone: "+27835550000",
        callFlag: "mafadi_air",
        state: "placed",
        requestedAt: minutesAgo(30),
      },
    });
    await placeDial("ours", minutesAgo(30));

    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result.considered).toBe(1);
    expect(fetchDialOutcome).toHaveBeenCalledTimes(1);
    expect(fetchDialOutcome.mock.calls[0][0]).toBe(orgId);
  });

  it("does not reconsider a dial that already has a result", async () => {
    await db.dialAttempt.create({
      data: {
        organizationId: orgId,
        suid: "done",
        name: "Hakeem Shaik",
        phone: "+27825104242",
        callFlag: "mafadi_air",
        state: "reached",
        requestedAt: minutesAgo(30),
      },
    });
    const result = await sweepDialOutcomes(orgId, { now: NOW });
    expect(result.considered).toBe(0);
    expect(fetchDialOutcome).not.toHaveBeenCalled();
  });
});
