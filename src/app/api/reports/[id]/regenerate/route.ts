import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { db } from "@/lib/db";
import { apiContext } from "@/lib/auth";
import { generateReport, type generateReportSchema } from "@/services/reports";
import type { z } from "zod";

// POST /api/reports/:id/regenerate — re-run a stored report with fresh data.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ id: string }> },
) {
  try {
    const ctx = await apiContext();
    const { id } = await params;
    const existing = await db.report.findFirst({
      where: { id, organizationId: ctx.organizationId },
    });
    if (!existing) return NextResponse.json({ error: "not_found" }, { status: 404 });

    const report = await generateReport(
      ctx.organizationId,
      ctx.userId,
      {
        type: existing.type,
        campaignId: existing.campaignId ?? undefined,
        agentId: existing.agentId ?? undefined,
      } as z.infer<typeof generateReportSchema>,
      existing.id,
    );
    return NextResponse.json({ id: report.id });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[reports] regeneration failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
