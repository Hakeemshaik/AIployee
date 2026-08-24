import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Organization settings — compliance / guardrail configuration and
// integration metadata. Guardrails are configurable per organization rather
// than hard-coded: collection rules differ by jurisdiction and mandate.
// ---------------------------------------------------------------------------

export async function getSettings(organizationId: string) {
  const [compliance, apiKeys, users, org] = await Promise.all([
    db.complianceSettings.findUnique({ where: { organizationId } }),
    db.apiKey.findMany({
      where: { organizationId },
      select: { id: true, name: true, keyPrefix: true, scopes: true, lastUsedAt: true, revokedAt: true, createdAt: true },
      orderBy: { createdAt: "desc" },
    }),
    db.user.findMany({
      where: { organizationId },
      select: { id: true, name: true, email: true, role: true },
      orderBy: { name: "asc" },
    }),
    db.organization.findUniqueOrThrow({ where: { id: organizationId } }),
  ]);
  return { compliance, apiKeys, users, org };
}

export const complianceSchema = z.object({
  callingHoursStart: z.string().regex(/^\d{2}:\d{2}$/),
  callingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/),
  callingDays: z.string().max(60),
  maxAttemptsPerDebtor: z.coerce.number().int().min(1).max(50),
  maxAttemptsPerDay: z.coerce.number().int().min(1).max(10),
  retryIntervalHours: z.coerce.number().int().min(1).max(720),
  recordingConsentRequired: z.coerce.boolean(),
  recordingDisclosure: z.string().max(500),
  escalateOnDispute: z.coerce.boolean(),
  escalateOnHardship: z.coerce.boolean(),
  escalateOnVulnerable: z.coerce.boolean(),
  maxAIArrangementAmount: z.coerce.number().min(0).max(10_000_000),
  honourOptOut: z.coerce.boolean(),
  freezeContactOnDispute: z.coerce.boolean(),
});

export async function updateComplianceSettings(
  organizationId: string,
  userId: string,
  input: z.infer<typeof complianceSchema>,
) {
  const data = complianceSchema.parse(input);
  const settings = await db.complianceSettings.upsert({
    where: { organizationId },
    create: { organizationId, ...data },
    update: data,
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "compliance.updated",
    entityType: "compliance_settings",
    entityId: settings.id,
  });
  return settings;
}
