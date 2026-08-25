import { createHash, randomBytes } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { seedDemoData } from "@/services/demo-seed";

// ---------------------------------------------------------------------------
// First-run bootstrap — powers the /setup page on a fresh deployment.
//
// Setup can only run while the database has NO organization; the moment one
// exists every setup call is refused, so the endpoint is inert on a live
// system. It creates the organization, admin user, compliance defaults, the
// voice agent placeholder and the integration API key (returned exactly once).
// ---------------------------------------------------------------------------

export async function getSetupStatus() {
  const [orgCount, orgName] = await Promise.all([
    db.organization.count(),
    db.organization.findFirst({ select: { name: true } }),
  ]);
  return { needsSetup: orgCount === 0, orgName: orgName?.name ?? null };
}

export const setupSchema = z.object({
  mode: z.enum(["clean", "demo"]),
  orgName: z.string().min(2).max(120).default("My Collections Organization"),
  adminName: z.string().min(2).max(120).default("Admin"),
  adminEmail: z.string().email().default("admin@example.com"),
});

export type SetupResult = {
  mode: "clean" | "demo";
  orgName: string;
  apiKey: string; // plaintext, shown exactly once
  demoKey?: string;
};

function newApiKey() {
  const plaintext = `aip_live_${randomBytes(24).toString("base64url")}`;
  return {
    plaintext,
    keyPrefix: plaintext.slice(0, 8),
    hashedKey: createHash("sha256").update(plaintext).digest("hex"),
  };
}

export async function runSetup(input: z.infer<typeof setupSchema>): Promise<SetupResult> {
  const data = setupSchema.parse(input);

  const existing = await db.organization.count();
  if (existing > 0) {
    throw new SetupLockedError("Setup has already been completed for this deployment.");
  }

  if (data.mode === "demo") {
    const { demoKey } = await seedDemoData();
    const org = await db.organization.findFirstOrThrow();
    // A production key alongside the documented demo key.
    const key = newApiKey();
    await db.apiKey.create({
      data: {
        organizationId: org.id,
        name: "Jobix production",
        keyPrefix: key.keyPrefix,
        hashedKey: key.hashedKey,
        scopes: "voice:ingest",
      },
    });
    return { mode: "demo", orgName: org.name, apiKey: key.plaintext, demoKey };
  }

  // Clean start — just the essentials for a real book.
  const org = await db.organization.create({
    data: {
      name: data.orgName,
      slug: data.orgName
        .toLowerCase()
        .replace(/[^a-z0-9]+/g, "-")
        .replace(/^-|-$/g, "")
        .slice(0, 60) || "organization",
    },
  });
  await db.user.create({
    data: { organizationId: org.id, name: data.adminName, email: data.adminEmail, role: "admin" },
  });
  await db.complianceSettings.create({ data: { organizationId: org.id } });
  await db.aIAgent.create({
    data: {
      organizationId: org.id,
      name: "Voice Agent",
      description: "Placeholder for your Jobix agent — set externalId to the Jobix agent id.",
      status: "active",
    },
  });
  const key = newApiKey();
  await db.apiKey.create({
    data: {
      organizationId: org.id,
      name: "Jobix production",
      keyPrefix: key.keyPrefix,
      hashedKey: key.hashedKey,
      scopes: "voice:ingest",
    },
  });
  await audit({
    organizationId: org.id,
    actorType: "system",
    action: "organization.bootstrapped",
    entityType: "organization",
    entityId: org.id,
    detail: { mode: data.mode },
  });
  return { mode: "clean", orgName: org.name, apiKey: key.plaintext };
}

export class SetupLockedError extends Error {}
