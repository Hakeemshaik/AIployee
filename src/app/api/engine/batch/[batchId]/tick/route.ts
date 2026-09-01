import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../../guard";
import { tickBatch } from "@/services/engine/dial";

// POST — one heartbeat: drip the next writes, ingest, run the guards. The
// engine screen calls this every two minutes while a batch is live; calling it
// twice is safe because every write is paced by the clock and every ingest is
// keyed on the conversation uuid.
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const ctx = await engineContext("advance a calling batch");
    const { batchId } = await params;
    const tick = await tickBatch(ctx.organizationId, batchId);
    return NextResponse.json(tick);
  } catch (err) {
    return engineError(err);
  }
}
