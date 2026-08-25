import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext } from "@/lib/auth";
import { generateReport, generateReportSchema } from "@/services/reports";

// POST /api/reports — generate a new report for the current organization.
export async function POST(request: Request) {
  try {
    const ctx = await apiContext();
    const body = await request.json();
    const parsed = generateReportSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "validation_failed", issues: z.treeifyError(parsed.error) },
        { status: 422 },
      );
    }
    const report = await generateReport(ctx.organizationId, ctx.userId, parsed.data);
    return NextResponse.json({ id: report.id, title: report.title }, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[reports] generation failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
