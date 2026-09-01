import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { sweepDialOutcomes } from "@/services/jobix/sweep-outcomes";

// POST /api/calling/sweep
//
// Fill in the dials nobody watched. The schedule does this every few minutes;
// this is the same thing on demand, so opening the app after a run of calls
// brings back what happened on them instead of waiting for the next tick.
//
// Reads only, and its budget is small: it is called on page load, so it must
// cost a page load, not a batch job.
export const maxDuration = 60;

export async function POST() {
  try {
    await blockGuests("fill in call results");
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager", "collector"], "fill in call results");

    const result = await sweepDialOutcomes(ctx.organizationId, { budget: 5 });
    return NextResponse.json(result);
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    if (err instanceof JobixError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error("[calling/sweep] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
