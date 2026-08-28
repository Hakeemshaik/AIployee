import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { callColumnValue, loadFlowConfig, parseFlowUuid, saveFlowConfig } from "./flow-config";

// ---------------------------------------------------------------------------
// The flow settings decide who gets dialled, so two things are pinned here:
// a saved value always beats the environment (that is the whole point of
// moving them out of env), and the `call` column resolver is the single place
// both the file export and the in-app dialler get their value from. They once
// disagreed, the flow filtered on a flag the stamp never wrote, and a run
// dialled nobody.
// ---------------------------------------------------------------------------

const UUID_A = "14f726d6-faa5-417c-9d7c-62b8e964c0f8";
const UUID_B = "aaaaaaaa-bbbb-cccc-dddd-eeeeeeeeeeee";

describe("parseFlowUuid", () => {
  it("takes the id out of a pasted address", () => {
    expect(parseFlowUuid(`https://dashboard.jobix.ai/automation/${UUID_A}`)).toBe(UUID_A);
  });

  it("accepts a bare id, and lowercases it", () => {
    expect(parseFlowUuid(UUID_A.toUpperCase())).toBe(UUID_A);
  });

  it("refuses anything without an id rather than saving a wrong flow", () => {
    expect(parseFlowUuid("MPM Main")).toBeNull();
    expect(parseFlowUuid("")).toBeNull();
  });
});

describe("callColumnValue", () => {
  const base = {
    flowUuid: null,
    flowUuidSource: "unset" as const,
    triggerNodeUuid: null,
    triggerNodeUuidSource: "unset" as const,
    callFlagSource: "saved" as const,
    flowStart: "insert" as const,
    flowStartSource: "unset" as const,
    triggerReady: false,
  };

  it("uses the fixed flag when there is one, so the flow filter never changes", () => {
    expect(callColumnValue({ ...base, callFlag: "READY" }, "AIP-20260828-1")).toBe("READY");
  });

  it("falls back to the batch code when no flag is configured", () => {
    expect(callColumnValue({ ...base, callFlag: null }, "AIP-20260828-1")).toBe("AIP-20260828-1");
  });

  it("arms nothing when there is neither", () => {
    expect(callColumnValue({ ...base, callFlag: null }, undefined)).toBeUndefined();
  });
});

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("saved flow settings (integration)", () => {
  let orgId = "";
  let userId = "";
  const original = { ...process.env };

  beforeEach(async () => {
    await db.integrationSettings.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Scratch", slug: "scratch-flow" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "flow@example.com", role: "admin" },
      })
    ).id;
    delete process.env.JOBIX_FLOW_UUID;
    delete process.env.JOBIX_TRIGGER_NODE_UUID;
    delete process.env.JOBIX_CALL_FLAG;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("falls back to the environment when nothing is saved", async () => {
    process.env.JOBIX_FLOW_UUID = UUID_B;
    process.env.JOBIX_CALL_FLAG = "ENVFLAG";
    const config = await loadFlowConfig(orgId);
    expect(config.flowUuid).toBe(UUID_B);
    expect(config.flowUuidSource).toBe("environment");
    expect(config.callFlag).toBe("ENVFLAG");
    expect(config.triggerReady).toBe(false); // no trigger node anywhere
  });

  it("prefers a saved value over the environment", async () => {
    process.env.JOBIX_FLOW_UUID = UUID_B;
    await saveFlowConfig(orgId, userId, {
      flowUuid: `https://dashboard.jobix.ai/automation/${UUID_A}`,
      triggerNodeUuid: "node-1",
      callFlag: "READY",
    });
    const config = await loadFlowConfig(orgId);
    expect(config.flowUuid).toBe(UUID_A);
    expect(config.flowUuidSource).toBe("saved");
    expect(config.triggerReady).toBe(true);
    expect(config.callFlag).toBe("READY");
  });

  it("clears back to the environment when a field is emptied", async () => {
    process.env.JOBIX_CALL_FLAG = "ENVFLAG";
    await saveFlowConfig(orgId, userId, { callFlag: "READY" });
    expect((await loadFlowConfig(orgId)).callFlag).toBe("READY");
    await saveFlowConfig(orgId, userId, { callFlag: "" });
    const config = await loadFlowConfig(orgId);
    expect(config.callFlag).toBe("ENVFLAG");
    expect(config.callFlagSource).toBe("environment");
  });

  it("refuses a flow address with no id in it", async () => {
    await expect(saveFlowConfig(orgId, userId, { flowUuid: "MPM Main" })).rejects.toThrow(/flow id/i);
    expect(await db.integrationSettings.findUnique({ where: { organizationId: orgId } })).toBeNull();
  });

  it("records the change, because dialling pointing elsewhere must be traceable", async () => {
    await saveFlowConfig(orgId, userId, { flowUuid: UUID_A, triggerNodeUuid: "node-1" });
    const entry = await db.auditLog.findFirst({ where: { action: "integration.flow_settings_saved" } });
    expect(entry).not.toBeNull();
    expect(entry!.detail).toContain(UUID_A);
  });

  it("keeps one organization's flow out of another's", async () => {
    const other = await db.organization.create({ data: { name: "Other", slug: "other-flow" } });
    await saveFlowConfig(orgId, userId, { flowUuid: UUID_A, triggerNodeUuid: "node-1" });
    const theirs = await loadFlowConfig(other.id);
    expect(theirs.flowUuid).toBeNull();
    expect(theirs.triggerReady).toBe(false);
  });
});
