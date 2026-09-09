import { NextResponse } from "next/server";
import { engineContext, engineError } from "../guard";
import { getEngineState } from "@/services/engine/state";

// GET /api/engine/<campaignId> — everything the engine screen shows.
export async function GET(_request: Request, { params }: { params: Promise<{ campaignId: string }> }) {
  try {
    const ctx = await engineContext("view the campaign engine");
    const { campaignId } = await params;
    return NextResponse.json(await getEngineState(ctx.organizationId, campaignId));
  } catch (err) {
    return engineError(err);
  }
}
