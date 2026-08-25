import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext, requireRole } from "@/lib/auth";
import { GuestBlockedError, isGuest } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { checkCallingWindow, dispatchBatch, prepareBatch } from "@/services/jobix/calling";

const schema = z.object({
  debtorIds: z.array(z.string().min(1)).min(1).max(5000),
  /** Preview returns the filtered count and value for the confirmation dialog. */
  preview: z.boolean().optional(),
  confirmed: z.boolean().optional(),
});

// GET /api/calling — window status, for disabling controls before a click.
export async function GET() {
  const window = checkCallingWindow();
  return NextResponse.json({
    window,
    guest: await isGuest(),
    callingEnabled: process.env.JOBIX_CALLING_ENABLED === "true",
    triggerConfigured: !!process.env.JOBIX_TRIGGER_PATH,
  });
}

// POST /api/calling — prepare (preview) or dispatch a call batch.
export async function POST(request: Request) {
  try {
    if (await isGuest()) throw new GuestBlockedError();
    const ctx = await getContext();
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
