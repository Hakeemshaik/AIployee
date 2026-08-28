import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// The stored sign-in.
//
// Two properties carry the whole design: a credential that does not work is
// never stored (so "saved" means "this signs in"), and the stored form does not
// contain the password in readable form. Everything else is bookkeeping.
// ---------------------------------------------------------------------------

const signInWith = vi.hoisted(() => vi.fn());
vi.mock("./auth", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./auth")>();
  return { ...actual, signInWith };
});

const { clearSignIn, saveSignIn, signInStatus, storedSignIn } = await import("./credentials");

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("stored Jobix sign-in (integration)", () => {
  let orgId = "";
  let userId = "";
  const original = { ...process.env };

  beforeEach(async () => {
    signInWith.mockReset();
    signInWith.mockResolvedValue("header.payload.signature");
    await db.serverSecret.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Cred Co", slug: "cred-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "cred@example.com", role: "admin" },
      })
    ).id;
    process.env.AUTH_SECRET = "a-long-enough-test-secret-value";
    delete process.env.JOBIX_EMAIL;
    delete process.env.JOBIX_PASSWORD;
    delete process.env.JOBIX_TOKEN;
    delete process.env.JOBIX_API_KEY;
  });

  afterEach(() => {
    process.env = { ...original };
  });

  it("verifies against Jobix before storing, and stores nothing when refused", async () => {
    const { JobixError } = await import("./client");
    signInWith.mockRejectedValue(
      new JobixError("Jobix rejected the sign-in — check JOBIX_EMAIL and JOBIX_PASSWORD.", "unauthorized"),
    );
    await expect(saveSignIn(orgId, userId, "ops@jobix.test", "wrong")).rejects.toThrow(/rejected/i);
    expect(await storedSignIn()).toBeNull();
    expect((await signInStatus()).using).toBe("none");
  });

  it("stores a working sign-in and reads it back", async () => {
    const status = await saveSignIn(orgId, userId, "ops@jobix.test", "aJ?9p({6S519");
    expect(signInWith).toHaveBeenCalledOnce();
    expect(status.stored).toBe(true);
    expect(status.using).toBe("stored");
    expect(status.email).toBe("ops@jobix.test");
    expect(await storedSignIn()).toEqual({ email: "ops@jobix.test", password: "aJ?9p({6S519" });
  });

  it("never keeps the password readable in the database", async () => {
    await saveSignIn(orgId, userId, "ops@jobix.test", "aJ?9p({6S519");
    const row = await db.serverSecret.findUniqueOrThrow({ where: { name: "jobix_sign_in" } });
    expect(row.value).not.toContain("aJ?9p({6S519");
    expect(row.value).not.toContain("ops@jobix.test");
  });

  it("never writes the password to the audit log", async () => {
    await saveSignIn(orgId, userId, "ops@jobix.test", "aJ?9p({6S519");
    const entry = await db.auditLog.findFirstOrThrow({ where: { action: "jobix.sign_in_saved" } });
    expect(entry.detail).toContain("ops@jobix.test");
    expect(entry.detail).not.toContain("aJ?9p({6S519");
  });

  it("drops the cached session token, so a new credential cannot ride an old session", async () => {
    await db.serverSecret.create({
      data: { name: "jobix_session_token", value: JSON.stringify({ token: "x", expiresAt: Date.now() + 1e6 }) },
    });
    await saveSignIn(orgId, userId, "ops@jobix.test", "correct");
    expect(await db.serverSecret.findUnique({ where: { name: "jobix_session_token" } })).toBeNull();
  });

  it("prefers the stored sign-in over the environment", async () => {
    process.env.JOBIX_EMAIL = "env@jobix.test";
    process.env.JOBIX_PASSWORD = "env-password";
    await saveSignIn(orgId, userId, "stored@jobix.test", "stored-password");
    const { resolveJobixEnv } = await import("./client");
    const env = await resolveJobixEnv();
    expect(env?.email).toBe("stored@jobix.test");
    expect(env?.password).toBe("stored-password");
    expect((await signInStatus()).environment).toBe(true);
  });

  it("falls back to the environment once the stored one is removed", async () => {
    process.env.JOBIX_EMAIL = "env@jobix.test";
    process.env.JOBIX_PASSWORD = "env-password";
    await saveSignIn(orgId, userId, "stored@jobix.test", "stored-password");
    const status = await clearSignIn(orgId, userId);
    expect(status.stored).toBe(false);
    expect(status.using).toBe("environment");
    const { resolveJobixEnv } = await import("./client");
    expect((await resolveJobixEnv())?.email).toBe("env@jobix.test");
  });

  it("refuses to leave the platform with no sign-in at all without saying so", async () => {
    await saveSignIn(orgId, userId, "stored@jobix.test", "stored-password");
    await expect(clearSignIn(orgId, userId)).rejects.toThrow(/no longer read Jobix/i);
  });

  it("treats a credential it cannot decrypt as absent rather than crashing", async () => {
    await saveSignIn(orgId, userId, "stored@jobix.test", "stored-password");
    // What a rotated AUTH_SECRET looks like from here.
    process.env.AUTH_SECRET = "a-completely-different-secret-value";
    expect(await storedSignIn()).toBeNull();
    expect((await signInStatus()).stored).toBe(false);
  });
});
