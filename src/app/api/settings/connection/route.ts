import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { testConnection } from "@/services/connection-status";

// POST /api/settings/connection — sign in to the voice platform and report
// what came back. Admin only: it names the workspace's agents.
export const maxDuration = 60;

export async function POST() {
  try {
    await blockGuests("test the voice platform connection");
    const ctx = await apiContext();
    requireRole(ctx, ["admin"], "test the voice platform connection");
    return NextResponse.json(await testConnection());
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[settings/connection] failed:", err);
    return NextResponse.json({ error: message, message }, { status: 500 });
  }
}
