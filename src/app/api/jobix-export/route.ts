import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext } from "@/lib/auth";
import { buildJobixExport } from "@/services/jobix-export";

// GET /api/jobix-export?campaignId=&format=csv|json
// Builds the paste-ready Jobix dialling list for the current organization.
export async function GET(request: Request) {
  try {
    const ctx = await apiContext();
    const params = new URL(request.url).searchParams;
    const result = await buildJobixExport(ctx.organizationId, {
      campaignId: params.get("campaignId") ?? undefined,
      minDaysOverdue: params.get("minDaysOverdue") ? Number(params.get("minDaysOverdue")) : undefined,
      minBalance: params.get("minBalance") ? Number(params.get("minBalance")) : undefined,
    });

    if (params.get("format") === "json") {
      return NextResponse.json(result);
    }
    const filename = `jobix-import-${result.batch.replace(/[^A-Za-z0-9-]+/g, "-").toLowerCase()}.csv`;
    return new NextResponse(result.csv, {
      headers: {
        "Content-Type": "text/csv; charset=utf-8",
        "Content-Disposition": `attachment; filename="${filename}"`,
      },
    });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[jobix-export] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
