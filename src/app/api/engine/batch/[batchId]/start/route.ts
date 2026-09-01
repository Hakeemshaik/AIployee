import { NextResponse } from "next/server";
import { engineContext, engineError } from "../../../guard";
import { startBatch } from "@/services/engine/dial";

// POST — call this batch. Every §3.2 guard runs server-side before a row moves.
export const maxDuration = 120;

export async function POST(_request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const ctx = await engineContext("start a calling batch");
    const { batchId } = await params;
    const tick = await startBatch(ctx.organizationId, batchId, ctx.userId);
    return NextResponse.json(tick);
  } catch (err) {
    return engineError(err);
  }
}
