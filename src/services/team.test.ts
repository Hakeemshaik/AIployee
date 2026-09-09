import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import {
  acceptInvite,
  changeRole,
  createInvite,
  inspectInvite,
  listTeam,
  removeUser,
  TeamError,
} from "./team";

// Opt-in, and only against a database whose name marks it as disposable —
// the same guard as the other integration suites.
const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("team management (integration)", () => {
  let orgId = "";
  let adminId = "";

  beforeEach(async () => {
    await db.invite.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Team Test Co", slug: "team-test-co" } });
    orgId = org.id;
    const admin = await db.user.create({
      data: { organizationId: orgId, name: "Owner", email: "owner@example.com", role: "admin", passwordHash: "scrypt$x" },
    });
    adminId = admin.id;
  });

  it("runs the full invite lifecycle: create, inspect, accept, sign-in-ready", async () => {
    const invite = await createInvite(orgId, adminId, {
      email: "New.Collector@Example.com",
      name: "Nadia Collector",
      role: "collector",
    });
    expect(invite.token.length).toBeGreaterThan(30);

    // The token is never stored — only its hash.
    const stored = await db.invite.findFirstOrThrow();
    expect(stored.tokenHash).not.toContain(invite.token);
    expect(stored.email).toBe("new.collector@example.com");

    const details = await inspectInvite(invite.token);
    expect(details.organizationName).toBe("Team Test Co");
    expect(details.role).toBe("collector");

    const { userId } = await acceptInvite(invite.token, "a long enough password");
    const user = await db.user.findUniqueOrThrow({ where: { id: userId } });
    expect(user.organizationId).toBe(orgId);
    expect(user.role).toBe("collector");
    expect(user.passwordHash).toBeTruthy();

    // Single use: the same link cannot create a second account.
    await expect(acceptInvite(invite.token, "another long password")).rejects.toThrow(TeamError);
  });

  it("refuses an invite for an email that already has an account", async () => {
    await expect(
      createInvite(orgId, adminId, { email: "owner@example.com", name: "Duplicate", role: "viewer" }),
    ).rejects.toMatchObject({ code: "email_taken" });
  });

  it("expires: an old invite neither inspects nor accepts", async () => {
    const invite = await createInvite(orgId, adminId, {
      email: "late@example.com",
      name: "Late Joiner",
      role: "viewer",
    });
    await db.invite.updateMany({ data: { expiresAt: new Date(Date.now() - 1000) } });
    await expect(inspectInvite(invite.token)).rejects.toMatchObject({ code: "invite_expired" });
    await expect(acceptInvite(invite.token, "a long enough password")).rejects.toMatchObject({
      code: "invite_expired",
    });
  });

  it("re-inviting the same address replaces the outstanding link", async () => {
    const first = await createInvite(orgId, adminId, { email: "x@example.com", name: "X", role: "viewer" });
    const second = await createInvite(orgId, adminId, { email: "x@example.com", name: "X", role: "viewer" });
    await expect(inspectInvite(first.token)).rejects.toMatchObject({ code: "invite_invalid" });
    await expect(inspectInvite(second.token)).resolves.toBeTruthy();
  });

  it("never demotes or removes the last admin", async () => {
    await expect(changeRole(orgId, adminId, adminId, "viewer")).rejects.toMatchObject({ code: "last_admin" });
    await expect(removeUser(orgId, adminId, adminId)).rejects.toMatchObject({ code: "last_admin" });

    // With a second admin, the first can be demoted.
    const other = await db.user.create({
      data: { organizationId: orgId, name: "Second", email: "second@example.com", role: "admin" },
    });
    await changeRole(orgId, other.id, adminId, "manager");
    expect((await db.user.findUniqueOrThrow({ where: { id: adminId } })).role).toBe("manager");
  });

  it("rejects an unknown role outright", async () => {
    await expect(
      createInvite(orgId, adminId, { email: "r@example.com", name: "R", role: "superuser" }),
    ).rejects.toMatchObject({ code: "invalid_role" });
  });
});

describe.skipIf(!scratch)("tenant isolation (integration)", () => {
  let orgA = "";
  let orgB = "";
  let adminA = "";

  beforeEach(async () => {
    await db.promiseToPay.deleteMany();
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.invite.deleteMany();
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.ingestionRun.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const a = await db.organization.create({ data: { name: "Org Alpha", slug: "org-alpha" } });
    const b = await db.organization.create({ data: { name: "Org Beta", slug: "org-beta" } });
    orgA = a.id;
    orgB = b.id;
    adminA = (
      await db.user.create({
        data: { organizationId: orgA, name: "Alpha Admin", email: "alpha@example.com", role: "admin" },
      })
    ).id;
    await db.user.create({
      data: { organizationId: orgB, name: "Beta Admin", email: "beta@example.com", role: "admin" },
    });

    await db.debtor.create({
      data: { organizationId: orgB, firstName: "Beta", lastName: "Debtor", accountNumber: "B-1", phone: "+27825550002" },
    });
    await db.jobixConversation.create({
      data: { organizationId: orgB, uuid: "conv-beta-1", phone: "+27825550002", startedAt: new Date(), sastHour: 9 },
    });
  });

  it("an account journey never crosses organizations", async () => {
    const { buildLiveJourney } = await import("./analytics/journey");
    const betaDebtor = await db.debtor.findFirstOrThrow({ where: { organizationId: orgB } });
    // Org A asking for org B's debtor id reads as not found, never as data.
    expect(await buildLiveJourney(orgA, betaDebtor.id)).toBeNull();
  });

  it("analytics only counts the caller's organization", async () => {
    const { buildLiveAnalytics } = await import("./analytics/live");
    const forA = await buildLiveAnalytics(orgA);
    expect(forA.rows).toHaveLength(0);
    const forB = await buildLiveAnalytics(orgB);
    expect(forB.rows).toHaveLength(1);
  });

  it("team listing and invites stay inside the organization", async () => {
    const teamA = await listTeam(orgA);
    expect(teamA.users.map((u) => u.email)).toEqual(["alpha@example.com"]);

    const invite = await createInvite(orgB, adminA, { email: "join-b@example.com", name: "Joiner", role: "viewer" });
    const joined = await acceptInvite(invite.token, "a long enough password");
    const user = await db.user.findUniqueOrThrow({ where: { id: joined.userId } });
    expect(user.organizationId).toBe(orgB);
    expect((await listTeam(orgA)).users).toHaveLength(1);
  });

  it("ingestion progress is scoped to the requesting organization", async () => {
    const { getIngestProgress } = await import("./jobix/ingest");
    await db.ingestionRun.create({ data: { organizationId: orgB, status: "completed", phase: "done" } });
    expect(await getIngestProgress(orgA)).toBeNull();
    expect((await getIngestProgress(orgB))?.status).toBe("completed");
  });
});
