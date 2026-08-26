import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { JobixError } from "@/services/jobix/client";
import { launchState, prepareLaunchList, startCampaignCalls } from "@/services/campaign-launch";

function jobixFailure(err: unknown): NextResponse | null {
  if (!(err instanceof JobixError)) return null;
  const status =
    err.code === "not_found" ? 404 : err.code === "not_configured" ? 501 : err.code === "rejected" ? 409 : 502;
  return NextResponse.json({ error: err.code, message: err.message }, { status });
}

// GET /api/campaigns/:id/launch — categorised contacts and launch readiness.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "launch campaigns");
    const { id } = await params;
    return NextResponse.json(await launchState(ctx.organizationId, id));
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const jobix = jobixFailure(err);
    if (jobix) return jobix;
    console.error("[campaigns/launch] state failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}

const schema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("prepare_list") }),
  z.object({ action: z.literal("start"), confirmed: z.literal(true) }),
]);

// POST /api/campaigns/:id/launch — generate the paste list, or start the calls.
export async function POST(request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "launch campaigns");
    const { id } = await params;

    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    if (parsed.data.action === "prepare_list") {
      return NextResponse.json(await prepareLaunchList(ctx.organizationId, ctx.userId, id));
    }
    return NextResponse.json(
      await startCampaignCalls(ctx.organizationId, ctx.userId, id, { confirmed: true }),
    );
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    const jobix = jobixFailure(err);
    if (jobix) return jobix;
    console.error("[campaigns/launch] action failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
