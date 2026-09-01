import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../guard";
import { buildRound } from "@/services/engine/rounds";

// POST /api/engine/<campaignId>/round — cut the next round into frozen batches.
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("build a calling round");
    const { campaignId } = await params;
    const plan = await buildRound(ctx.organizationId, campaignId, ctx.userId);
    return NextResponse.json(plan, { status: 201 });
  } catch (err) {
    return engineError(err);
  }
}
