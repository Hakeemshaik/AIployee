import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { JobixError } from "@/services/jobix/client";
import { checkArmed, launchState, prepareLaunchList, startCampaignCalls } from "@/services/campaign-launch";
import { cancelSchedule, scheduleCampaign } from "@/services/campaign-schedule";

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
  // Either an explicit instant or "this many minutes from now". A schedule is
  // the confirmation to dial, so it carries the same flag a live start does.
  z.object({
    action: z.literal("schedule"),
    confirmed: z.literal(true),
    at: z.coerce.date().optional(),
    minutes: z.coerce.number().int().min(1).max(20_160).optional(),
  }),
  z.object({ action: z.literal("cancel_schedule") }),
  z.object({ action: z.literal("check_armed") }),
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
    if (parsed.data.action === "schedule") {
      const at =
        parsed.data.at ??
        (parsed.data.minutes ? new Date(Date.now() + parsed.data.minutes * 60_000) : null);
      if (!at) {
        return NextResponse.json(
          { error: "validation_failed", message: "Give a time or a number of minutes." },
          { status: 422 },
        );
      }
      return NextResponse.json(await scheduleCampaign(ctx.organizationId, ctx.userId, id, at));
    }
    if (parsed.data.action === "check_armed") {
      return NextResponse.json(await checkArmed(ctx.organizationId, id));
    }
    if (parsed.data.action === "cancel_schedule") {
      return NextResponse.json(await cancelSchedule(ctx.organizationId, ctx.userId, id));
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
