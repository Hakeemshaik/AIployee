import { createHmac, timingSafeEqual } from "crypto";
import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { mapOutcome, mapStatus, pick, toDate } from "@/services/voice/jobix/mapping";
import { processCallCompleted } from "@/services/integrations/voice";

// ---------------------------------------------------------------------------
// Jobix webhook processing.
//
// Every inbound event is recorded in ProviderEvent BEFORE it is acted on, and
// the (provider, externalEventId) unique constraint makes redelivery a no-op:
// a repeated event can never create a second call, promise or escalation.
//
// Terminal call events are funnelled into the existing call pipeline
// (processCallCompleted), so a Jobix call and a directly-posted call get
// identical treatment: transcript analysis, promise creation, escalation,
// debtor state, campaign metrics, events and audit.
// ---------------------------------------------------------------------------

/** Event families the receiver understands, independent of provider naming. */
export const TERMINAL_EVENTS = [
  "call.completed",
  "call.ended",
  "call.finished",
  "conversation.completed",
  "conversation.ended",
  "call.failed",
  "call.no_answer",
  "call.busy",
  "call.voicemail",
];
export const PROGRESS_EVENTS = ["call.started", "call.ringing", "call.answered", "call.initiated"];
export const CAMPAIGN_EVENTS = [
  "campaign.started",
  "campaign.paused",
  "campaign.completed",
  "campaign.stopped",
  "campaign.finished",
];

export const jobixEventSchema = z.object({
  // Any of these may carry the event id / type depending on payload shape.
  id: z.string().optional(),
  event_id: z.string().optional(),
  uuid: z.string().optional(),
  event: z.string().optional(),
  type: z.string().optional(),
  event_type: z.string().optional(),
  data: z.record(z.string(), z.unknown()).optional(),
  payload: z.record(z.string(), z.unknown()).optional(),
}).passthrough();

export type WebhookOutcome =
  | { status: "processed"; eventType: string; callId?: string; outcome?: string | null }
  | { status: "duplicate"; eventId: string }
  | { status: "ignored"; reason: string; eventType: string };

/** Constant-time HMAC-SHA256 signature check. */
export function verifySignature(rawBody: string, header: string | null, secret: string): boolean {
  if (!header) return false;
  // Accept "sha256=<hex>", "<hex>", or a base64 digest.
  const provided = header.replace(/^sha256=/i, "").trim();
  // Accept either encoding: providers differ on hex vs base64 digests.
  const candidates = [
    createHmac("sha256", secret).update(rawBody, "utf8").digest("hex"),
    createHmac("sha256", secret).update(rawBody, "utf8").digest("base64"),
  ];
  return candidates.some((expected) => {
    if (expected.length !== provided.length) return false;
    try {
      return timingSafeEqual(Buffer.from(expected), Buffer.from(provided));
    } catch {
      return false;
    }
  });
}

function normalizeType(raw: string): string {
  return raw.trim().toLowerCase().replace(/[\s:-]+/g, ".").replace(/\.{2,}/g, ".");
}

export async function processJobixEvent(
  organizationId: string,
  rawBody: string,
  parsed: z.infer<typeof jobixEventSchema>,
): Promise<WebhookOutcome> {
  const body = { ...parsed, ...(parsed.data ?? {}), ...(parsed.payload ?? {}) } as Record<string, unknown>;
  const eventType = normalizeType(
    String(parsed.event ?? parsed.type ?? parsed.event_type ?? pick(body, ["event", "type"]) ?? "unknown"),
  );
  // Fall back to a content hash so an event without an id is still deduped.
  const externalEventId = String(
    parsed.event_id ??
      parsed.id ??
      parsed.uuid ??
      pick(body, ["event_id", "id", "uuid", "call_id", "conversation_id"]) ??
      createHmac("sha256", "event-id").update(rawBody).digest("hex").slice(0, 32),
  );

  const settings = await db.integrationSettings.findUnique({ where: { organizationId } });
  let overrides: Record<string, string> = {};
  try {
    overrides = settings?.outcomeMap ? JSON.parse(settings.outcomeMap) : {};
  } catch {
    overrides = {};
  }

  // Idempotency gate — the create fails if this event was already seen.
  let eventRow;
  try {
    eventRow = await db.providerEvent.create({
      data: {
        organizationId,
        provider: "jobix",
        externalEventId,
        type: eventType,
        payload: rawBody.slice(0, 100_000),
      },
    });
  } catch {
    return { status: "duplicate", eventId: externalEventId };
  }

  const finish = async (
    status: string,
    extra: { error?: string; callId?: string } = {},
  ) => {
    await db.providerEvent.update({
      where: { id: eventRow!.id },
      data: { status, processedAt: new Date(), error: extra.error, callId: extra.callId },
    });
  };

  try {
    // --- campaign lifecycle -------------------------------------------------
    if (CAMPAIGN_EVENTS.includes(eventType)) {
      const providerCampaignId = String(pick(body, ["campaign_id", "campaign", "batch_id"]) ?? "");
      if (!providerCampaignId) {
        await finish("ignored", { error: "no campaign id in payload" });
        return { status: "ignored", reason: "no campaign id in payload", eventType };
      }
      const nextStatus = eventType.endsWith("paused")
        ? "paused"
        : eventType.endsWith("started")
          ? "running"
          : "completed";
      const updated = await db.campaign.updateMany({
        where: { organizationId, providerCampaignId },
        data: { status: nextStatus },
      });
      await db.redialBatch.updateMany({
        where: { organizationId, providerCampaignId },
        data: { status: nextStatus === "running" ? "running" : nextStatus, ...(nextStatus === "completed" ? { completedAt: new Date() } : {}) },
      });
      await finish(updated.count > 0 ? "processed" : "ignored");
      return updated.count > 0
        ? { status: "processed", eventType }
        : { status: "ignored", reason: "no campaign matched that provider id", eventType };
    }

    // --- in-flight progress -------------------------------------------------
    // Recorded for the live feed; no debtor state changes until the call ends.
    if (PROGRESS_EVENTS.includes(eventType)) {
      await finish("processed");
      return { status: "processed", eventType };
    }

    // --- terminal call events ----------------------------------------------
    if (!TERMINAL_EVENTS.includes(eventType)) {
      await finish("ignored", { error: `unhandled event type: ${eventType}` });
      return { status: "ignored", reason: `unhandled event type: ${eventType}`, eventType };
    }

    const phone = pick<string>(body, ["phone_number", "phone", "to", "destination"]);
    const reference = pick<string>(body, ["reference", "client_reference", "external_id"]);
    const providerCallId = String(
      pick(body, ["call_id", "conversation_id", "uuid", "id"]) ?? externalEventId,
    );
    const durationSeconds = Math.max(0, Math.round(Number(pick(body, ["duration", "duration_seconds", "talk_time"]) ?? 0)) || 0);
    const rawStatus = pick<string>(body, ["status", "call_status", "disposition", "state"]) ?? null;
    const rawOutcome =
      pick<string>(body, ["outcome", "result", "call_outcome", "calloutcome_tag", "outcome_category"]) ?? null;

    // The event name itself carries the status when the payload omits it.
    const statusFromEvent = eventType.endsWith("no_answer")
      ? "no_answer"
      : eventType.endsWith("busy")
        ? "busy"
        : eventType.endsWith("voicemail")
          ? "voicemail"
          : eventType.endsWith("failed")
            ? "failed"
            : null;
    const status = statusFromEvent ?? mapStatus(rawStatus ?? (durationSeconds > 0 ? "completed" : "no_answer"), overrides);
    const mappedOutcome = mapOutcome(rawOutcome, overrides);

    // Resolve the contact: our own reference first, phone only as a fallback.
    let debtorId: string | undefined;
    let campaignId: string | undefined;
    if (reference) {
      const contact = await db.campaignContact.findFirst({
        where: { id: String(reference), organizationId },
        select: { debtorId: true, campaignId: true },
      });
      if (contact) {
        debtorId = contact.debtorId;
        campaignId = contact.campaignId;
      }
    }

    const result = await processCallCompleted(organizationId, `jobix:webhook`, {
      externalCallId: providerCallId,
      ...(debtorId ? { debtorId } : {}),
      ...(campaignId ? { campaignId } : {}),
      ...(phone && !debtorId ? { phone: String(phone) } : {}),
      externalAgentId: pick<string>(body, ["agent_id", "agent_uuid"]) ?? undefined,
      direction: "outbound",
      startedAt: toDate(pick(body, ["started_at", "created_at", "start_time"])) ?? new Date(),
      endedAt: toDate(pick(body, ["ended_at", "end_time", "completed_at"])) ?? undefined,
      durationSeconds,
      status,
      transcript: (pick<string>(body, ["transcript", "transcription"]) as string | undefined) ?? undefined,
      recordingUrl: (pick<string>(body, ["recording_url", "recording", "audio_url"]) as string | undefined) ?? undefined,
      outcome: mappedOutcome ?? undefined,
      providerBatchId: (pick<string>(body, ["campaign_id", "batch_id"]) as string | undefined) ?? undefined,
      callbackAt: toDate(pick(body, ["callback_time", "callback_at", "callback_date_time"])) ?? undefined,
    });

    await finish("processed", { callId: result.callId });
    await audit({
      organizationId,
      actorType: "integration",
      actorId: "jobix:webhook",
      action: "webhook.processed",
      entityType: "provider_event",
      entityId: eventRow.id,
      detail: { eventType, callId: result.callId, duplicate: result.duplicate },
    });
    return {
      status: "processed",
      eventType,
      callId: result.callId,
      outcome: "outcome" in result ? result.outcome : null,
    };
  } catch (err) {
    const message = err instanceof Error ? err.message : "processing failed";
    await finish("failed", { error: message.slice(0, 500) });
    throw err;
  }
}
