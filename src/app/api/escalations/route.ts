import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext } from "@/lib/auth";
import { createEscalation, createEscalationSchema } from "@/services/escalations";

// POST /api/escalations — manually escalate a debtor to a human collector.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    const body = await request.json();
    const parsed = createEscalationSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const escalation = await createEscalation(ctx.organizationId, ctx.userId, parsed.data);
    return NextResponse.json({ id: escalation.id }, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[escalations] creation failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
