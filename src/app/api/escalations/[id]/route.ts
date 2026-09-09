import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext } from "@/lib/auth";
import { updateEscalation, updateEscalationSchema } from "@/services/escalations";

// PATCH /api/escalations/:id — update status / assignment / resolution.
export async function PATCH(
  request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await apiContext();
    const { id } = await params;
    const body = await request.json();
    const parsed = updateEscalationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const escalation = await updateEscalation(ctx.organizationId, ctx.userId, id, parsed.data);
    return NextResponse.json({ id: escalation.id, status: escalation.status });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[escalations] update failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
