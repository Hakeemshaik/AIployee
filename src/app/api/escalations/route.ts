import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { createEscalation, createEscalationSchema } from "@/services/escalations";

// POST /api/escalations — manually escalate a debtor to a human collector.
export async function POST(request: Request) {
  try {
    const ctx = await getContext();
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
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[escalations] creation failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
