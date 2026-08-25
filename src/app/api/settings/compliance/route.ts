import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext } from "@/lib/auth";
import { complianceSchema, updateComplianceSettings } from "@/services/settings";

// PUT /api/settings/compliance — update the organization's guardrails.
export async function PUT(request: Request) {
  try {
    const ctx = await apiContext();
    const body = await request.json();
    const parsed = complianceSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const settings = await updateComplianceSettings(ctx.organizationId, ctx.userId, parsed.data);
    return NextResponse.json({ id: settings.id });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[settings] compliance update failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
