import { NextResponse } from "next/server";
import { z } from "zod";
import { engineContext, engineError } from "../../../guard";
import { resumeBatch } from "@/services/engine/dial";

// POST — resume a paused batch, optionally at lower concurrency, optionally
// voiding the failed run so it never counts against anybody's attempt cap.
const schema = z.object({
  maxConcurrency: z.coerce.number().int().min(1).max(8).optional(),
  voidAndRerun: z.boolean().optional(),
});

export async function POST(request: Request, { params }: { params: Promise<{ batchId: string }> }) {
  try {
    const ctx = await engineContext("resume a calling batch");
    const { batchId } = await params;
    const body = schema.parse(await request.json().catch(() => ({})));
    await resumeBatch(ctx.organizationId, batchId, ctx.userId, body);
    return NextResponse.json({ ok: true });
  } catch (err) {
    return engineError(err);
  }
}
