import { db } from "@/lib/db";

// Audit logging. Keep `detail` to identifiers and small business values —
// never transcripts, phone numbers, or other sensitive payloads.

export async function audit(entry: {
  organizationId: string;
  actorType: "user" | "system" | "integration" | "ai";
  actorId?: string;
  action: string;
  entityType: string;
  entityId: string;
  detail?: Record<string, unknown>;
}): Promise<void> {
  try {
    await db.auditLog.create({
      data: {
        organizationId: entry.organizationId,
        actorType: entry.actorType,
        actorId: entry.actorId,
        action: entry.action,
        entityType: entry.entityType,
        entityId: entry.entityId,
        detail: entry.detail ? JSON.stringify(entry.detail) : null,
      },
    });
  } catch (err) {
    // Auditing must never break the business operation.
    console.error("[audit] failed to write audit log:", err);
  }
}
