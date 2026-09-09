import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../guard";
import { resyncRound } from "@/services/engine/resync";

// POST /api/engine/<campaignId>/resync — read the current round's results from
// the platform now, and report who is left to redial. Dials nothing.
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("resync results");
    const { campaignId } = await params;
    const result = await resyncRound(ctx.organizationId, campaignId, ctx.userId);
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    return engineError(err);
  }
}
