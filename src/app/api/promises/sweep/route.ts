import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { apiContext } from "@/lib/auth";
import { sweepBrokenPromises } from "@/services/promises";

// POST /api/promises/sweep — mark promises overdue past the grace period as broken.
export async function POST() {
  try {
    const ctx = await apiContext();
    const marked = await sweepBrokenPromises(ctx.organizationId);
    return NextResponse.json({ marked });
  } catch (err) {
    const denied = authFailure(err);
    if (denied) return denied;
    console.error("[promises] sweep failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
