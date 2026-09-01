import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { JobixError } from "@/services/jobix/client";
import { sweepDialOutcomes } from "@/services/jobix/sweep-outcomes";

// ---------------------------------------------------------------------------
// Scheduled catch-up on call results.
//
// The outcome webhook is the mechanism; this is what covers the gap when it is
// not configured, when a delivery is lost, or when the call simply ended after
// everybody had gone home. It runs often, because the value of a result decays:
// a promise to pay captured on Friday afternoon is worth acting on before
// Monday.
//
// Same shape as the scheduled import, for the same reasons: the shared secret
// is required rather than optional, and a deployment with more than one
// organization is refused because there is no session to say whose dials these
// are.
// ---------------------------------------------------------------------------

export const maxDuration = 120;

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
        message: "Scheduled outcome sweeps are disabled: set CRON_SECRET to enable this endpoint.",
      },
      { status: 503 },
    );
  }

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
            : "This deployment has multiple organizations; a scheduled sweep has no session to say whose dials to fill in.",
      },
      { status: 409 },
    );
  }
  const organizationId = organizations[0].id;

  try {
    const result = await sweepDialOutcomes(organizationId);
    // Only worth an audit entry when it actually did something — a sweep that
    // finds nothing open runs every few minutes and would drown the log.
    if (result.filled > 0 || result.abandoned > 0 || result.failed > 0) {
      await audit({
        organizationId,
        actorType: "system",
        action: "jobix.outcome_sweep",
        entityType: "dial_attempt",
        entityId: "sweep",
        detail: { ...result },
      });
    }
    return NextResponse.json(result);
  } catch (err) {
    const message = err instanceof Error ? err.message : "outcome sweep failed";
    console.error("[cron/outcomes] failed:", err);
    return NextResponse.json(
      { error: err instanceof JobixError ? err.code : "internal_error", message },
      { status: 502 },
    );
  }
}

export const GET = handle;
export const POST = handle;
