import { NextResponse } from "next/server";
import { getContext } from "@/lib/auth";
import { isGuest } from "@/lib/session";
import { buildDemoJourney, buildLiveJourney } from "@/services/analytics/journey";

// GET /api/accounts/:id/journey — one account's calls, transcripts and
// messaging steps, for the analytics drawer.
//
// Guests get the fixture; everyone else is scoped to their own organisation by
// getContext, so an account id from another tenant reads as not found.
export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params;

    if (await isGuest()) {
      const journey = buildDemoJourney(id);
      if (!journey) return NextResponse.json({ error: "not_found" }, { status: 404 });
      return NextResponse.json(journey);
    }

    const ctx = await getContext();
    const journey = await buildLiveJourney(ctx.organizationId, id);
    if (!journey) return NextResponse.json({ error: "not_found" }, { status: 404 });
    return NextResponse.json(journey);
  } catch (err) {
    console.error("[accounts/journey] failed:", err);
    return NextResponse.json({ error: "internal_error" }, { status: 500 });
  }
}
