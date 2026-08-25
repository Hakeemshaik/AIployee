import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { sweepBrokenPromises } from "@/services/promises";

// POST /api/promises/sweep — mark promises overdue past the grace period as broken.
export async function POST() {
  try {
    const ctx = await getContext();
    const marked = await sweepBrokenPromises(ctx.organizationId);
    return NextResponse.json({ marked });
  } catch (err) {
    console.error("[promises] sweep failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
