import { NextResponse } from "next/server";
import { authFailure } from "@/lib/api-errors";
import { z } from "zod";
import { apiContext, requireRole } from "@/lib/auth";
import { blockGuests, GuestBlockedError } from "@/lib/session";
import { JobixError } from "@/services/jobix/client";
import { getIngestProgress, reconcileStalledRun, runIngestion } from "@/services/jobix/ingest";

// Ingestion holds this request open for the entire pull — conversations page
// by page, then one request per uncached transcript. On Vercel the platform
// default duration kills that mid-run, so the limit is raised to the Hobby-plan
// maximum. A run that still hits the ceiling is not lost: it checkpoints as it
// goes and never re-fetches a cached transcript, so pressing Run again resumes.
export const maxDuration = 300;

const schema = z.object({
  since: z.coerce.date().optional(),
  expectedAgentNames: z.array(z.string()).max(10).optional(),
  transcriptLimit: z.coerce.number().int().min(1).max(5000).optional(),
});

// GET /api/ingest — progress of the latest run.
export async function GET() {
  try {
    const ctx = await apiContext();
    // A killed run leaves a row claiming to be alive; settle that before
    // reporting, so the panel never spins on a dead run.
    await reconcileStalledRun(ctx.organizationId);
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
    const ctx = await apiContext();
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
    const denied = authFailure(err);
    if (denied) return denied;
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
