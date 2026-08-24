import { NextResponse } from "next/server";
import { z } from "zod";
import { verifyApiKey } from "@/lib/api-auth";
import {
  callCompletedSchema,
  IntegrationError,
  processCallCompleted,
} from "@/services/integrations/voice";

// POST /api/integrations/voice/call-completed
//
// Inbound webhook for the external AI voice platform. Authenticated with a
// per-organization API key (Authorization: Bearer <key>, scope voice:ingest).
// The organization is derived from the key — payloads can never write into
// another tenant.

export async function POST(request: Request) {
  const auth = await verifyApiKey(request, "voice:ingest");
  if (!auth) {
    return NextResponse.json(
      { error: "unauthorized", message: "A valid API key with the voice:ingest scope is required." },
      { status: 401 },
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

  const parsed = callCompletedSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }
  if (!parsed.data.debtorId && !parsed.data.accountNumber && !parsed.data.phone) {
    return NextResponse.json(
      { error: "validation_failed", message: "One of debtorId, accountNumber or phone is required." },
      { status: 422 },
    );
  }

  try {
    const result = await processCallCompleted(auth.organizationId, auth.apiKeyId, parsed.data);
    return NextResponse.json(
      result.duplicate
        ? { status: "duplicate", callId: result.callId }
        : { status: "processed", ...result },
      { status: result.duplicate ? 200 : 201 },
    );
  } catch (err) {
    if (err instanceof IntegrationError) {
      return NextResponse.json({ error: err.code, message: err.message }, { status: err.status });
    }
    console.error("[voice] call-completed processing failed:", err);
    return NextResponse.json(
      { error: "internal_error", message: "Failed to process the call." },
      { status: 500 },
    );
  }
}
