import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { fetchDialOutcome } from "@/services/jobix/fetch-outcome";
import { getDialAttempt } from "@/services/dial-attempts";

// POST /api/calling/one/<attemptId>/fetch
//
// Go and read the result off the platform, for a deployment whose flow does not
// post outcomes back. Reads only — it pulls the conversation for the number
// this dial rang and puts it through the same path the webhook uses.
export const maxDuration = 60;

export async function POST(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;
    await blockGuests("read a call result");
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager", "collector"], "read a call result");

    const outcome = await fetchDialOutcome(ctx.organizationId, id);
    const attempt = await getDialAttempt(ctx.organizationId, id);
    return NextResponse.json({ ...outcome, attempt });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    if (err instanceof JobixError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: 400 });
    }
    console.error("[calling/one/fetch] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
