import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/api-auth";
import { checkRateLimit } from "@/lib/rate-limit";
import { dialOutcomeSchema, recordDialOutcome } from "@/services/integrations/dial-outcome";
import { IntegrationError } from "@/services/integrations/voice";

// POST /api/integrations/voice/dial-outcome
//
// What happened on one call, keyed on the suid this platform minted for the
// write that placed it. Authenticated with a per-organization API key
// (Authorization: Bearer <key>, scope voice:ingest), so the organization comes
// from the key and a payload can never write into another tenant.
//
// This exists alongside call-completed rather than replacing it: that endpoint
// takes a call the platform already knows about and matches it to an account by
// number or reference. This one takes the reference this platform issued, which
// is the only join a dial-on-insert flow has.
export const maxDuration = 60;

export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "voice:ingest");
  if (!auth) {
    return NextResponse.json(
      { error: "unauthorized", message: "A valid API key with the voice:ingest scope is required." },
      { status: 401 },
    );
  }

  const rate = checkRateLimit(`dial-outcome:${auth.apiKeyId}`, { limit: 240, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited", message: "Too many requests — slow down and retry." },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let body: unknown;
  try {
    body = await request.json();
  } catch {
    return NextResponse.json(
      { error: "invalid_json", message: "Request body must be valid JSON." },
      { status: 400 },
    );
  }

  const parsed = dialOutcomeSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }

  try {
    const result = await recordDialOutcome(auth.organizationId, auth.apiKeyId, parsed.data);
    return NextResponse.json(result, { status: result.duplicate ? 200 : 201 });
  } catch (err) {
    if (err instanceof IntegrationError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[voice] dial outcome failed:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to record the outcome." },
      { status: 500 },
    );
  }
}
