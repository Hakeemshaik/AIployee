import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import {
  previewReset,
  resetOrganizationData,
  ResetNotConfirmedError,
} from "@/services/data-reset";

// GET /api/settings/reset — what a reset would remove, and what it would keep.
export async function GET() {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "clear organization data");
    return NextResponse.json(await previewReset(ctx.organizationId, ctx.userId));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[settings/reset] preview failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

const schema = z.object({
  confirmation: z.string().min(1).max(200),
  newOrganizationName: z.string().min(2).max(120).optional(),
  includeIngestedData: z.boolean().optional(),
});

// POST /api/settings/reset — delete the demo book. Admin only, and refused
// unless the organization name is typed exactly.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "clear organization data");

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }

    const result = await resetOrganizationData({
      organizationId: ctx.organizationId,
      actorId: ctx.userId,
      confirmation: parsed.data.confirmation,
      newOrganizationName: parsed.data.newOrganizationName,
      includeIngestedData: parsed.data.includeIngestedData,
    });
    return NextResponse.json(result);
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof ResetNotConfirmedError) {
      return NextResponse.json({ error: "not_confirmed", message: err.message }, { status: 422 });
    }
    console.error("[settings/reset] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
