import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { getIngestProgress, runIngestion } from "@/services/jobix/ingest";

const schema = z.object({
  since: z.coerce.date().optional(),
  expectedAgentNames: z.array(z.string()).max(10).optional(),
  transcriptLimit: z.coerce.number().int().min(1).max(5000).optional(),
});

// GET /api/ingest — progress of the latest run.
export async function GET() {
  try {
    const ctx = await getContext();
    const progress = await getIngestProgress(ctx.organizationId);
    return NextResponse.json(progress ?? { status: "idle" });
  } catch {
    return NextResponse.json({ status: "idle" });
  }
}

// POST /api/ingest — pull conversations, transcripts and customers from Jobix.
export async function POST(request: Request) {
  try {
    await blockGuests("run ingestion");
    const ctx = await getContext();
    requireRole(ctx, ["admin", "manager"], "run ingestion");
    const parsed = schema.safeParse(await request.json().catch(() => ({})));
    if (!parsed.success) {
      return NextResponse.json({ error: "validation_failed" }, { status: 422 });
    }
    const progress = await runIngestion({
      organizationId: ctx.organizationId,
      since: parsed.data.since,
      expectedAgentNames: parsed.data.expectedAgentNames,
      transcriptLimit: parsed.data.transcriptLimit,
    });
    return NextResponse.json(progress, { status: 201 });
  } catch (err) {
    if (err instanceof GuestBlockedError) {
      return NextResponse.json({ error: "demo_mode", message: err.message }, { status: 403 });
    }
    if (err instanceof JobixError) {
      // A workspace mismatch must block ingestion with a clear error.
      return NextResponse.json(
        { error: err.code, message: err.message, detail: err.detail },
        { status: err.code === "workspace_mismatch" ? 409 : err.code === "not_configured" ? 501 : 502 },
      );
    }
    const message = err instanceof Error ? err.message : "internal_error";
    console.error("[ingest] failed:", err);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
