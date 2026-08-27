import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { runDueCampaigns } from "@/services/campaign-schedule";

// POST /api/campaigns/due — start any campaign whose scheduled time has passed.
//
// The campaign page calls this while somebody has it open. That is what makes
// "start in five minutes" work regardless of how often the host's own
// scheduler runs; /api/cron/campaigns covers the unattended case.
export async function POST() {
  try {
    await blockGuests("start scheduled campaigns");
    const ctx = await apiContext();
    requireRole(ctx, ["admin", "manager"], "start scheduled campaigns");
    const outcomes = await runDueCampaigns(ctx.organizationId);
    return NextResponse.json({ outcomes });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[campaigns/due] failed:", err);
    return NextResponse.json({ error: message, message }, { status: 500 });
  }
}
