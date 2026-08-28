import { NextResponse } from "next/server";
import { z } from "zod";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { FlowConfigError, inspectFlow, loadFlowConfig, saveFlowConfig } from "@/services/flow-config";
import { JobixError } from "@/services/jobix/client";

// The dialling flow's settings. Admin only — these decide which flow the
// platform triggers, so changing them changes who gets called.
export const maxDuration = 60;

const saveSchema = z.object({
  flowUuid: z.string().max(400).optional(),
  triggerNodeUuid: z.string().max(200).optional(),
  callFlag: z.string().max(120).optional(),
});

const inspectSchema = z.object({ inspect: z.string().min(1).max(400) });

export async function GET() {
  try {
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "view the dialling flow settings");
    return NextResponse.json(await loadFlowConfig(ctx.organizationId));
  } catch (err) {
    return fail(err);
  }
}

export async function POST(request: Request) {
  try {
    await blockGuests("change the dialling flow settings");
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "change the dialling flow settings");
    const body = await request.json();

    // Reading a flow is a different request from saving one, so a look does not
    // commit anything.
    const look = inspectSchema.safeParse(body);
    if (look.success) return NextResponse.json(await inspectFlow(look.data.inspect));

    const parsed = saveSchema.safeParse(body);
    if (!parsed.success) {
      return NextResponse.json(
        { error: "invalid_request", message: "Send a flow to inspect, or the settings to save." },
        { status: 400 },
      );
    }
    return NextResponse.json(await saveFlowConfig(ctx.organizationId, ctx.userId, parsed.data));
  } catch (err) {
    return fail(err);
  }
}

function fail(err: unknown) {
  const denied = authFailure(err);
  if (denied) return denied;
  if (err instanceof GuestBlockedError) {
    return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
  }
  // A bad paste, or credentials that are not on this deployment, is the
  // caller's to fix. Answering 500 would file both as crashes and bury the
  // failures that actually need looking at.
  if (err instanceof FlowConfigError) {
    return NextResponse.json({ error: "invalid_request", message: err.message }, { status: 400 });
  }
  if (err instanceof JobixError && err.code === "not_configured") {
    return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
  }
  const message = err instanceof Error ? err.message : "internal_error";
  console.error("[settings/flow] failed:", err);
  return NextResponse.json({ error: message, message }, { status: 500 });
}
