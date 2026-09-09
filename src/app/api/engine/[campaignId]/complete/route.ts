import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../guard";
import { completeCampaign } from "@/services/engine/complete";

// POST /api/engine/<campaignId>/complete — freeze the campaign, forever.
export async function POST(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("complete a campaign");
    const { campaignId } = await params;
    const report = await completeCampaign(ctx.organizationId, campaignId, ctx.userId);
    return NextResponse.json(report);
  } catch (err) {
    return engineError(err);
  }
}
