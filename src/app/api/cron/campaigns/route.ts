import { NextResponse } from "next/server";
import { timingSafeEqual } from "node:crypto";
import { db } from "@/lib/db";
import { runDueCampaigns } from "@/services/campaign-schedule";

// ---------------------------------------------------------------------------
// Unattended scheduled starts.
//
// Same shape as the scheduled import: the secret is required, so with
// CRON_SECRET unset this refuses rather than exposing a way to make the
// platform dial. This one triggers real phone calls, which is why it does not
// get a convenient fallback.
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
        message: "Scheduled campaign starts are disabled: set CRON_SECRET to enable this endpoint.",
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
            : "This deployment has multiple organizations; an unattended start has no session to say whose campaigns to run.",
      },
      { status: 409 },
    );
  }

  const outcomes = await runDueCampaigns(organizations[0].id);
  return NextResponse.json({ outcomes });
}

export const GET = handle;
export const POST = handle;
