import { afterEach, describe, expect, it } from "vitest";
import { connectionStatus } from "./connection-status";

// ---------------------------------------------------------------------------
// The three states are the whole point. "Set in the dashboard" and "the
// running server received it" are different facts, and a blank value looks
// identical to a missing one in every screenshot — so they are reported
// separately, and that distinction is pinned here.
// ---------------------------------------------------------------------------

const KEYS = ["JOBIX_EMAIL", "JOBIX_PASSWORD"];

afterEach(() => {
  for (const key of KEYS) delete process.env[key];
});

function stateOf(name: string) {
  return connectionStatus().vars.find((v) => v.name === name)!.state;
}

describe("connectionStatus", () => {
  it("reports a variable that is not present as missing", () => {
    expect(stateOf("JOBIX_EMAIL")).toBe("missing");
  });

  it("reports a present but blank variable as empty, not missing", () => {
    process.env.JOBIX_EMAIL = "";
    expect(stateOf("JOBIX_EMAIL")).toBe("empty");
    // Whitespace-only counts as blank: a paste that lost its value looks
    // exactly like this.
    process.env.JOBIX_EMAIL = "   ";
    expect(stateOf("JOBIX_EMAIL")).toBe("empty");
  });

  it("reports a real value as set", () => {
    process.env.JOBIX_EMAIL = "ops@example.com";
    expect(stateOf("JOBIX_EMAIL")).toBe("set");
  });

  it("never returns the value itself", () => {
    process.env.JOBIX_PASSWORD = "a-real-secret-value";
    const serialised = JSON.stringify(connectionStatus());
    expect(serialised).not.toContain("a-real-secret-value");
  });

  it("only offers a live test when both sign-in variables are usable", () => {
    expect(connectionStatus().canTest).toBe(false);

    process.env.JOBIX_EMAIL = "ops@example.com";
    process.env.JOBIX_PASSWORD = "";
    expect(connectionStatus().canTest).toBe(false);
    expect(connectionStatus().summary).toMatch(/blank/i);

    process.env.JOBIX_PASSWORD = "something";
    expect(connectionStatus().canTest).toBe(true);
  });

  it("tells the reader to redeploy when the variables are absent", () => {
    expect(connectionStatus().summary).toMatch(/redeploy/i);
  });
});
