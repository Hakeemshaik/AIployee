import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { getSession, GuestBlockedError, isGuest } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { checkCallingWindow, dispatchBatch, prepareBatch } from "@/services/jobix/calling";

// Dispatch stamps the batch code, then waits and re-reads to verify, because
// customer/save is asynchronous on the provider's side — longer than the
// platform's default function duration.
export const maxDuration = 120;

const schema = z.object({
  debtorIds: z.array(z.string().min(1)).min(1).max(5000),
  /** Preview returns the filtered count and value for the confirmation dialog. */
  preview: z.boolean().optional(),
  confirmed: z.boolean().optional(),
});

// GET /api/calling — window status, for disabling controls before a click.
//
// Needs a session: guests are served (their UI shows the disabled state) but an
// anonymous caller has no business learning how this server is configured.
export async function GET() {
  const session = await getSession();
  if (!session) {
    return NextResponse.json({ error: "not_authenticated" }, { status: 401 });
  }
  return NextResponse.json({
    window: checkCallingWindow(),
    guest: session.kind === "guest",
    callingEnabled: process.env.JOBIX_CALLING_ENABLED === "true",
    // The path has a confirmed default; what actually gates the trigger is
    // knowing WHICH flow and WHICH Now node to run.
    triggerConfigured: !!process.env.JOBIX_FLOW_UUID && !!process.env.JOBIX_TRIGGER_NODE_UUID,
  });
}

// POST /api/calling — prepare (preview) or dispatch a call batch.
export async function POST(request: Request) {
  try {
    if (await isGuest()) throw new GuestBlockedError();
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "start calls");

    const parsed = schema.safeParse(await request.json());
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }

    if (parsed.data.preview) {
      const batch = await prepareBatch(ctx.organizationId, parsed.data.debtorIds);
      return NextResponse.json({
        accounts: batch.candidates.length,
        totalValue: Math.round(batch.totalValue),
        excluded: batch.excluded,
        window: batch.window,
      });
    }

    const result = await dispatchBatch(ctx.organizationId, ctx.userId, parsed.data.debtorIds, {
      confirmed: parsed.data.confirmed === true,
    });
    return NextResponse.json(result, { status: 201 });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    if (err instanceof JobixError) {
      return NextResponse.json(
        { error: err.code, message: err.message, detail: err.detail },
        { status: err.code === "not_configured" ? 501 : 400 },
      );
    }
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not permitted") ? 403 : 500;
    if (status === 500) console.error("[calling] failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
