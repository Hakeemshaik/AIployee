import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { ESCALATION_STATUSES } from "@/lib/domain";

// ---------------------------------------------------------------------------
// Escalation service — the human hand-off queue.
// ---------------------------------------------------------------------------

export async function listEscalations(
  organizationId: string,
  filters: { status?: string; priority?: string; reason?: string } = {},
) {
  return db.escalation.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.priority ? { priority: filters.priority } : {}),
      ...(filters.reason ? { reason: filters.reason } : {}),
    },
    include: {
      debtor: { select: { id: true, firstName: true, lastName: true, accountNumber: true } },
      campaign: { select: { id: true, name: true } },
      assignedTo: { select: { id: true, name: true } },
      call: { select: { id: true } },
    },
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
}

export async function getEscalationStats(organizationId: string) {
  const escalations = await db.escalation.findMany({
    where: { organizationId },
    select: { status: true, priority: true },
  });
  return {
    open: escalations.filter((e) => e.status === "open").length,
    inReview: escalations.filter((e) => e.status === "in_review").length,
    assigned: escalations.filter((e) => e.status === "assigned").length,
    resolved: escalations.filter((e) => e.status === "resolved").length,
    urgent: escalations.filter((e) => e.priority === "urgent" && e.status !== "resolved").length,
  };
}

export const updateEscalationSchema = z.object({
  status: z.enum(ESCALATION_STATUSES).optional(),
  assignedToUserId: z.string().nullable().optional(),
  resolutionNotes: z.string().max(2000).optional(),
});

export async function updateEscalation(
  organizationId: string,
  userId: string,
  escalationId: string,
  input: z.infer<typeof updateEscalationSchema>,
) {
  const data = updateEscalationSchema.parse(input);
  const existing = await db.escalation.findFirst({ where: { id: escalationId, organizationId } });
  if (!existing) throw new Error("Escalation not found");
  if (data.assignedToUserId) {
    const user = await db.user.findFirst({ where: { id: data.assignedToUserId, organizationId } });
    if (!user) throw new Error("Assignee not found in this organization");
  }
  const escalation = await db.escalation.update({
    where: { id: escalationId },
    data: {
      ...data,
      ...(data.assignedToUserId && !data.status ? { status: "assigned" } : {}),
      ...(data.status === "resolved" ? { resolvedAt: new Date() } : {}),
    },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "escalation.updated",
    entityType: "escalation",
    entityId: escalationId,
    detail: { from: existing.status, to: escalation.status },
  });
  return escalation;
}

export async function listUsers(organizationId: string) {
  return db.user.findMany({
    where: { organizationId },
    select: { id: true, name: true, role: true },
    orderBy: { name: "asc" },
  });
}
