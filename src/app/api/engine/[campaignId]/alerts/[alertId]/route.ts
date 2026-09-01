import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../../guard";
import { acknowledgeAlert } from "@/services/engine/guards";

// POST — a person has read the blocking alert; the block lifts, the record stays.
export async function POST(
  _request: Request,
  { params }: { params: Promise<{ campaignId: string; alertId: string }> },
) {
  try {
    const ctx = await engineContext("acknowledge an engine alert");
    const { alertId } = await params;
    await acknowledgeAlert(ctx.organizationId, alertId, ctx.userId);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return engineError(err);
  }
}
