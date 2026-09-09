import { describe, expect, it } from "vitest";
import { batchCode, CALLING_WINDOWS, checkCallingWindow } from "./calling";

// Times are given in UTC; SAST is UTC+2.
const utc = (iso: string) => new Date(iso);

describe("calling-hours hard gate", () => {
  it("allows weekday mid-morning", () => {
    // Tue 2026-08-18 08:00 UTC = 10:00 SAST
    const check = checkCallingWindow(utc("2026-08-18T08:00:00Z"));
    expect(check.allowed).toBe(true);
    expect(check.sastTime).toBe("10:00 SAST");
  });

  it("blocks before 08:00 SAST on a weekday", () => {
    // 05:30 UTC = 07:30 SAST
    const check = checkCallingWindow(utc("2026-08-18T05:30:00Z"));
    expect(check.allowed).toBe(false);
    expect(check.reason).toMatch(/Tuesday calling window/);
  });

  it("blocks from 19:00 SAST on a weekday", () => {
    // 17:00 UTC = 19:00 SAST — the window ends AT 19:00
    expect(checkCallingWindow(utc("2026-08-18T17:00:00Z")).allowed).toBe(false);
    // 16:59 UTC = 18:59 SAST is still allowed
    expect(checkCallingWindow(utc("2026-08-18T16:45:00Z")).allowed).toBe(true);
  });

  it("allows Saturday morning only", () => {
    // Sat 2026-08-22 08:00 UTC = 10:00 SAST
    expect(checkCallingWindow(utc("2026-08-22T08:00:00Z")).allowed).toBe(true);
    // Sat 12:00 UTC = 14:00 SAST — past the 13:00 cutoff
    expect(checkCallingWindow(utc("2026-08-22T12:00:00Z")).allowed).toBe(false);
    // Sat 06:00 UTC = 08:00 SAST — before the 09:00 start
    expect(checkCallingWindow(utc("2026-08-22T06:00:00Z")).allowed).toBe(false);
  });

  it("never allows Sunday", () => {
    for (const hour of [6, 8, 10, 12, 15, 18]) {
      const check = checkCallingWindow(utc(`2026-08-23T${String(hour).padStart(2, "0")}:00:00Z`));
      expect(check.allowed).toBe(false);
      expect(check.reason).toMatch(/No calling on Sunday/);
    }
    expect(CALLING_WINDOWS[0]).toBeNull();
  });

  it("evaluates in SAST even when the server clock is UTC late evening", () => {
    // 22:00 UTC Monday = 00:00 SAST Tuesday — must be blocked, not allowed
    expect(checkCallingWindow(utc("2026-08-17T22:00:00Z")).allowed).toBe(false);
  });
});

describe("flow trigger contract (captured from the flow builder)", () => {
  // The trigger request was captured from DevTools on the Run button. These
  // pin what the capture established, so a refactor cannot drift back to the
  // earlier guessed shape (snake_case with an inline filter — Jobix accepts
  // neither).
  it("targets the dashboard host path, not the write API", async () => {
    const source = (await import("node:fs")).readFileSync("src/services/jobix/calling.ts", "utf8");
    expect(source).toContain('"/api/nodes/now/trigger"');
    expect(source).toContain("postDashboard(");
    // The old guess must be gone: no filter in the trigger payload.
    expect(source).not.toContain("flow_uuid");
    expect(source).not.toMatch(/trigger[\s\S]{0,300}operator: "Equals"/);
  });

  it("sends camelCase flowUuid and nodeUuid", async () => {
    const source = (await import("node:fs")).readFileSync("src/services/jobix/calling.ts", "utf8");
    const trigger = source.slice(source.indexOf("postDashboard("));
    expect(trigger).toContain("flowUuid: flow.flowUuid");
    expect(trigger).toContain("nodeUuid: flow.triggerNodeUuid");
  });

  it("stays inert without the Now node uuid", async () => {
    const source = (await import("node:fs")).readFileSync("src/services/jobix/calling.ts", "utf8");
    expect(source).toContain("flow.flowUuid && flow.triggerNodeUuid");
  });

  it("arms records with the flow's flag and attributes them with the batch code", async () => {
    // The bug this pins: writing the batch code into `call` while the flow
    // filters on a fixed flag arms nothing, and the run dials nobody. The two
    // columns must be written from the shared resolver, not improvised here.
    const source = (await import("node:fs")).readFileSync("src/services/jobix/calling.ts", "utf8");
    const stamp = source.slice(source.indexOf("/v1/customer/save"), source.indexOf("stamped += 1"));
    expect(stamp).toContain("batch: batch.batchCode");
    expect(stamp).toContain("call: armWith");
    expect(stamp).not.toContain("call: batch.batchCode");
    expect(source).toContain("callColumnValue(flow, batch.batchCode)");
  });
});

describe("batch codes", () => {
  it("is the same shape in every month of the year", () => {
    // September is the trap: en-GB's short month is "Sept", four letters where
    // every other month gives three, so the code silently changed shape on
    // 1 September. Codes are matched and read against each other.
    for (let month = 0; month < 12; month += 1) {
      const code = batchCode(new Date(Date.UTC(2026, month, 15)));
      expect(code).toMatch(/^\d{1,2}[A-Z]{3}-[A-Z0-9]{4}$/);
    }
    expect(batchCode(new Date(Date.UTC(2026, 8, 1)))).toMatch(/^1SEP-/);
  });

  it("does not repeat itself, so two runs on a day stay apart", () => {
    const day = new Date(Date.UTC(2026, 7, 28));
    const codes = new Set(Array.from({ length: 50 }, () => batchCode(day)));
    expect(codes.size).toBeGreaterThan(45);
  });
});
