import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { checkRateLimit } from "@/lib/rate-limit";
import { verifyApiKey } from "@/lib/api-auth";
import {
  jobixEventSchema,
  processJobixEvent,
  verifySignature,
} from "@/services/integrations/jobix-webhook";

// POST /api/webhooks/jobix
//
// Inbound events from the voice platform. Authentication accepts either:
//   • an HMAC signature over the raw body (JOBIX_WEBHOOK_SECRET), verified
//     constant-time — preferred when the provider supports signing; or
//   • a platform API key with the voice:ingest scope, for providers that can
//     only send a static header.
//
// The organization is always derived from the credential, never from the
// payload. Every event is deduplicated on its provider event id.
export async function POST(request: Request) {
  const rawBody = await request.text();
  const secret = process.env.JOBIX_WEBHOOK_SECRET;
  const signature =
    request.headers.get("x-jobix-signature") ??
    request.headers.get("x-webhook-signature") ??
    request.headers.get("x-signature");

  let organizationId: string | null = null;
  let actor = "jobix:signature";

  if (secret && signature) {
    if (!verifySignature(rawBody, signature, secret)) {
      return NextResponse.json(
        { error: "invalid_signature", message: "Webhook signature verification failed." },
        { status: 401 },
      );
    }
    // The signature proves the sender knows the deployment's secret — it does
    // NOT identify a tenant, because JOBIX_WEBHOOK_SECRET is one value for the
    // whole deployment. With one organization that is unambiguous; with more
    // than one it would write call data into an arbitrary tenant, so the
    // signed path refuses outright rather than guessing. Multi-organization
    // deployments must use per-organization API keys (the Bearer path below).
    const organizations = await db.organization.count();
    if (organizations > 1) {
      return NextResponse.json(
        {
          error: "ambiguous_tenant",
          message:
            "This deployment has multiple organizations, so the shared webhook secret cannot identify one. Use a per-organization API key (Authorization: Bearer) instead.",
        },
        { status: 409 },
      );
    }
    const settings = await db.integrationSettings.findFirst({
      where: { provider: "jobix" },
      select: { organizationId: true },
    });
    organizationId =
      settings?.organizationId ??
      (await db.organization.findFirst({ orderBy: { createdAt: "asc" }, select: { id: true } }))?.id ??
      null;
  } else {
    const auth = await verifyApiKey(request, "voice:ingest");
    if (!auth) {
      return NextResponse.json(
        {
          error: "unauthorized",
          message:
            "Provide a valid webhook signature (JOBIX_WEBHOOK_SECRET) or a Bearer API key with the voice:ingest scope.",
        },
        { status: 401 },
      );
    }
    organizationId = auth.organizationId;
    actor = auth.apiKeyId;
  }

  if (!organizationId) {
    return NextResponse.json(
      { error: "not_configured", message: "No organization is configured to receive Jobix events." },
      { status: 503 },
    );
  }

  const rate = checkRateLimit(`jobix:${actor}`, { limit: 600, windowMs: 60_000 });
  if (!rate.allowed) {
    return NextResponse.json(
      { error: "rate_limited" },
      { status: 429, headers: { "Retry-After": String(rate.retryAfterSeconds) } },
    );
  }

  let json: unknown;
  try {
    json = JSON.parse(rawBody);
  } catch {
    return NextResponse.json({ error: "invalid_json" }, { status: 400 });
  }
  const parsed = jobixEventSchema.safeParse(json);
  if (!parsed.success) {
    return NextResponse.json({ error: "validation_failed" }, { status: 422 });
  }

  try {
    const result = await processJobixEvent(organizationId, rawBody, parsed.data);
    // 200 on duplicate/ignored so the provider stops retrying a known event.
    return NextResponse.json(result, { status: 200 });
  } catch (err) {
    console.error("[webhooks/jobix] processing failed:", err);
    // 500 so the provider retries — the event row records the failure.
    return NextResponse.json({ error: "processing_failed" }, { status: 500 });
  }
}
