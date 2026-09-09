import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext } from "@/lib/auth";
import { generateInsights } from "@/services/insights";

// POST /api/insights/generate — refresh AI insights for a scope.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    const body = await request.json().catch(() => ({}));
    const scope = body.scope === "dashboard" ? "dashboard" : "insights";
    const result = await generateInsights(ctx.organizationId, scope, {
      periodDays: typeof body.periodDays === "number" ? Math.min(365, Math.max(1, body.periodDays)) : 30,
    });
    return NextResponse.json({ id: result.id, provider: result.provider }, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[insights] generation failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
