import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { JobixError } from "@/services/jobix/client";
import { runIngestion } from "@/services/jobix/ingest";

// ---------------------------------------------------------------------------
// Scheduled import.
//
// The fastest import is the one that already ran. This endpoint exists so a
// schedule can keep the platform current overnight, and opening the analytics
// screen shows yesterday's calls without anybody pressing anything.
//
// It runs with no signed-in user, so it is deliberately narrow:
//
//   * a shared secret is REQUIRED. With CRON_SECRET unset the route refuses
//     rather than running unauthenticated — a public endpoint that pulls a
//     client's book is not an acceptable failure mode.
//   * the window is fixed at the last two days. A schedule that could be asked
//     for "everything" would be a way to burn the request budget on demand.
//   * it refuses on a multi-organization deployment, exactly as the interactive
//     path does, because the provider connection is deployment-wide and there
//     is no session to say whose data this is.
// ---------------------------------------------------------------------------

export const maxDuration = 300;

const WINDOW_DAYS = 2;

/** Compare without leaking length or position through timing. */
function secretMatches(provided: string, expected: string): boolean {
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  if (a.length !== b.length) return false;
  return timingSafeEqual(a, b);
}

async function handle(request: Request) {
  const expected = process.env.CRON_SECRET;
  if (!expected) {
    return NextResponse.json(
      {
        error: "not_configured",
        message: "Scheduled imports are disabled: set CRON_SECRET to enable this endpoint.",
      },
      { status: 503 },
    );
  }

  // Vercel Cron sends the secret as a bearer token on the scheduled request.
  const header = request.headers.get("authorization") ?? "";
  const provided = header.startsWith("Bearer ") ? header.slice(7) : "";
  if (!provided || !secretMatches(provided, expected)) {
    return NextResponse.json({ error: "unauthorized" }, { status: 401 });
  }

  const organizations = await db.organization.findMany({ select: { id: true }, take: 2 });
  if (organizations.length !== 1) {
    return NextResponse.json(
      {
        error: "rejected",
        message:
          organizations.length === 0
            ? "No organization on this deployment."
            : "This deployment has multiple organizations; a scheduled import has no session to say whose data to pull.",
      },
      { status: 409 },
    );
  }
  const organizationId = organizations[0].id;

  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 3_600_000);
  try {
    const progress = await runIngestion({ organizationId, since });
    await audit({
      organizationId,
      actorType: "system",
      action: "jobix.scheduled_import",
      entityType: "ingestion_run",
      entityId: progress.runId,
      detail: {
        status: progress.status,
        windowDays: WINDOW_DAYS,
        conversations: progress.conversationsFound,
        transcriptsFetched: progress.transcriptsFetched,
        transcriptsPending: progress.transcriptsPending,
      },
    });
    return NextResponse.json({
      status: progress.status,
      conversations: progress.conversationsFound,
      transcriptsFetched: progress.transcriptsFetched,
      transcriptsPending: progress.transcriptsPending,
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : "scheduled import failed";
    console.error("[cron/ingest] failed:", err);
    return NextResponse.json(
      { error: err instanceof JobixError ? err.code : "internal_error", message },
      { status: 502 },
    );
  }
}

// Vercel Cron issues a GET. POST is accepted so the schedule can be triggered
// by hand with the same secret when checking it works.
export const GET = handle;
export const POST = handle;
