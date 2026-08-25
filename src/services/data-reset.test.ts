import { beforeEach, describe, expect, it } from "vitest";
import { db } from "@/lib/db";
import { resetOrganizationData, slugify } from "./data-reset";

// ---------------------------------------------------------------------------
// The reset deletes real rows, so its invariants are tested against a real
// database rather than mocks. These tests TRUNCATE the database they run
// against, so they are opt-in and refuse to touch anything that is not
// obviously a scratch database:
//
//   psql -c 'CREATE DATABASE aiployee_test'
//   export SCRATCH=postgresql://…/aiployee_test
//   DATABASE_URL=$SCRATCH DIRECT_DATABASE_URL=$SCRATCH npx prisma migrate deploy
//   DATABASE_URL=$SCRATCH TEST_DATABASE_RESET=1 npm test
//
// Without TEST_DATABASE_RESET the integration block is skipped, so the suite
// stays runnable anywhere.
// ---------------------------------------------------------------------------

describe("slugify", () => {
  it("builds a url-safe slug", () => {
    expect(slugify("Meridian Recoveries")).toBe("meridian-recoveries");
    expect(slugify("AIployee (Pty) Ltd")).toBe("aiployee-pty-ltd");
    expect(slugify("  Spaces   Everywhere  ")).toBe("spaces-everywhere");
  });

  it("never returns an empty slug", () => {
    expect(slugify("!!!")).toBe("organization");
    expect(slugify("")).toBe("organization");
  });

  it("caps length", () => {
    expect(slugify("x".repeat(200)).length).toBeLessThanOrEqual(60);
  });
});

// Opt-in, and only against a database whose name marks it as disposable — a
// test that deletes every row must never be able to run against a real one.
const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("resetOrganizationData (integration)", () => {
  let orgId = "";
  let keeperId = "";
  let otherUserId = "";

  beforeEach(async () => {
    // A miniature of the seeded demo book.
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.apiKey.deleteMany();
    await db.jobixTranscript.deleteMany();
    await db.jobixConversation.deleteMany();
    await db.auditLog.deleteMany();
    await db.aIAgent.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({
      data: { name: "Demo Recoveries", slug: "demo-recoveries" },
    });
    orgId = org.id;
    const keeper = await db.user.create({
      data: { organizationId: orgId, name: "Owner", email: "owner@example.com", role: "admin", passwordHash: "scrypt$x" },
    });
    keeperId = keeper.id;
    const other = await db.user.create({
      data: { organizationId: orgId, name: "Seeded Person", email: "seeded@example.com", role: "collector" },
    });
    otherUserId = other.id;

    await db.debtor.create({
      data: {
        organizationId: orgId,
        firstName: "Fictional",
        lastName: "Debtor",
        accountNumber: "ACC-1",
        phone: "+27820000001",
      },
    });
    await db.apiKey.create({
      data: { organizationId: orgId, name: "Demo key", keyPrefix: "aip_demo", hashedKey: "abc", scopes: "voice:ingest" },
    });
    await db.jobixConversation.create({
      data: { organizationId: orgId, uuid: "conv-keep-1", phone: "+27820000001", startedAt: new Date(), sastHour: 9 },
    });
  });

  it("refuses a confirmation that is not the exact organization name", async () => {
    for (const attempt of ["demo recoveries", "Demo Recovery", "", "Demo  Recoveries"]) {
      await expect(
        resetOrganizationData({
          organizationId: orgId,
          actorId: keeperId,
          confirmation: attempt,
        }),
      ).rejects.toThrow(/exactly/i);
    }
    // Nothing was touched.
    expect(await db.debtor.count()).toBe(1);
    expect(await db.user.count()).toBe(2);
  });

  it("never deletes the acting user — that would lock the operator out", async () => {
    await resetOrganizationData({
      organizationId: orgId,
      actorId: keeperId,
      confirmation: "Demo Recoveries",
    });
    const survivors = await db.user.findMany();
    expect(survivors).toHaveLength(1);
    expect(survivors[0].id).toBe(keeperId);
    expect(await db.user.findUnique({ where: { id: otherUserId } })).toBeNull();
  });

  it("revokes every API key, including the seeded one", async () => {
    const result = await resetOrganizationData({
      organizationId: orgId,
      actorId: keeperId,
      confirmation: "Demo Recoveries",
    });
    expect(result.keysRevoked).toBe(1);
    expect(await db.apiKey.count()).toBe(0);
  });

  it("keeps provider-ingested data by default and removes it only when asked", async () => {
    await resetOrganizationData({
      organizationId: orgId,
      actorId: keeperId,
      confirmation: "Demo Recoveries",
    });
    expect(await db.jobixConversation.count()).toBe(1);

    await resetOrganizationData({
      organizationId: orgId,
      actorId: keeperId,
      confirmation: "Demo Recoveries",
      includeIngestedData: true,
    });
    expect(await db.jobixConversation.count()).toBe(0);
  });

  it("clears the book, renames the organization and leaves one usable agent", async () => {
    const result = await resetOrganizationData({
      organizationId: orgId,
      actorId: keeperId,
      confirmation: "Demo Recoveries",
      newOrganizationName: "Real Company",
    });
    expect(result.organizationName).toBe("Real Company");
    expect(await db.debtor.count()).toBe(0);

    const org = await db.organization.findUniqueOrThrow({ where: { id: orgId } });
    expect(org.name).toBe("Real Company");
    expect(org.slug).toBe("real-company");

    // A campaign needs an agent to point at.
    expect(await db.aIAgent.count()).toBe(1);
    // The reset itself is the first entry of the real book.
    const logs = await db.auditLog.findMany();
    expect(logs).toHaveLength(1);
    expect(logs[0].action).toBe("organization.data_reset");
  });
});
