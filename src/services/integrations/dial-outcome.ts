import { z } from "zod";
import { db } from "@/lib/db";
import { IntegrationError, processCallCompleted } from "./voice";

// ---------------------------------------------------------------------------
// What happened on the call.
//
// The voice platform posts one of these per attempt, keyed on the suid this
// platform minted for the write. That is the only join available: the write is
// the call, so there is no call id to agree on beforehand, and matching on a
// phone number would tie a result to whichever record happened to share it.
//
// The body is the shape the workspace's forms already receive — suid, status,
// a transcript as turns, timings, a recording — so the same webhook
// configuration works here without being re-authored. Everything is optional
// except the suid and the status, because a platform that only knows "nobody
// answered" should still be able to say so.
// ---------------------------------------------------------------------------

/** What the platform calls it, and what it means here. */
const STATUS_MAP: Record<string, { state: string; call: string }> = {
  answered: { state: "reached", call: "completed" },
  completed: { state: "reached", call: "completed" },
  human: { state: "reached", call: "completed" },
  no_answer: { state: "no_answer", call: "no_answer" },
  "no-answer": { state: "no_answer", call: "no_answer" },
  noanswer: { state: "no_answer", call: "no_answer" },
  busy: { state: "no_answer", call: "busy" },
  voicemail: { state: "no_answer", call: "voicemail" },
  machine: { state: "no_answer", call: "voicemail" },
  failed: { state: "failed", call: "failed" },
  error: { state: "failed", call: "failed" },
  cancelled: { state: "failed", call: "failed" },
};

export const dialOutcomeSchema = z.object({
  /** The reference minted for the write. The join, and the only required id. */
  suid: z.string().min(1).max(120),
  status: z.string().min(1).max(40),
  /** The platform's own id for this attempt, when it has one. */
  event_id: z.string().max(160).optional(),
  attempt: z.coerce.number().int().min(1).max(99).optional(),
  final: z.boolean().optional(),
  started_at: z.coerce.date().optional(),
  ended_at: z.coerce.date().optional(),
  duration_seconds: z.coerce.number().int().min(0).max(24 * 3600).optional(),
  to_number: z.string().max(32).optional(),
  agent: z.string().max(120).optional(),
  recording_url: z.string().url().max(2000).optional(),
  /** The agent's structured output — whatever the flow was told to emit. */
  values: z.record(z.string(), z.unknown()).optional(),
  /** Turns, or one block of text. Both arrive in the wild. */
  transcript: z
    .union([
      z.string().max(200_000),
      z.array(
        z.object({
          role: z.string().max(40).optional(),
          text: z.string().max(20_000),
          time: z.string().max(60).optional(),
        }),
      ),
    ])
    .optional(),
});

export type DialOutcomePayload = z.infer<typeof dialOutcomeSchema>;

/** Turns become one readable block; a block stays as it is. */
export function flattenTranscript(transcript: DialOutcomePayload["transcript"]): string | undefined {
  if (!transcript) return undefined;
  if (typeof transcript === "string") return transcript.trim() || undefined;
  const lines = transcript
    .map((turn) => {
      const who = (turn.role ?? "").toLowerCase();
      // "assistant" is what an API calls it; nobody on a collections team does.
      const speaker = who === "assistant" || who === "agent" || who === "bot" ? "Agent" : "Customer";
      return `${speaker}: ${turn.text.trim()}`;
    })
    .filter((line) => line.length > 8);
  return lines.length > 0 ? lines.join("\n") : undefined;
}

/**
 * Some flows state the outcome themselves rather than leaving it to be read
 * off the transcript. Only a value that is one of ours is taken; anything else
 * is left for the classifier, which is better at this than a mapping table.
 */
const STATED_OUTCOMES = new Set([
  "promise_to_pay",
  "payment_arrangement",
  "paid_in_full_claimed",
  "dispute",
  "financial_hardship",
  "refused_to_pay",
  "wrong_number",
  "callback_requested",
  "no_commitment",
  "escalated",
  "opted_out",
]);

export function statedOutcome(values: Record<string, unknown> | undefined): string | undefined {
  if (!values) return undefined;
  for (const key of ["outcome", "call_outcome", "calloutcome_tag", "outcome_category", "lead_status"]) {
    const raw = values[key];
    if (typeof raw !== "string") continue;
    const normalised = raw.trim().toLowerCase().replace(/[\s-]+/g, "_");
    if (STATED_OUTCOMES.has(normalised)) return normalised;
  }
  return undefined;
}

export type DialOutcomeResult = {
  attemptId: string;
  suid: string;
  state: string;
  /** The call row it became, when the attempt belonged to an account. */
  callId: string | null;
  /** True when this outcome had already been recorded. */
  duplicate: boolean;
};

/**
 * Record what happened, and put it through the pipeline the rest of the
 * platform already reads.
 *
 * An attempt against a real account goes through `processCallCompleted`, so the
 * transcript is analysed, a promise to pay becomes a promise row, an
 * escalation becomes an escalation, and the account's status moves — exactly as
 * it does for a call that arrived any other way. An attempt dialled by hand has
 * no account to hang any of that on, so it keeps the transcript and the outcome
 * on itself and nothing else is invented.
 */
export async function recordDialOutcome(
  organizationId: string,
  apiKeyId: string,
  payload: DialOutcomePayload,
): Promise<DialOutcomeResult> {
  const attempt = await db.dialAttempt.findFirst({
    where: { organizationId, suid: payload.suid },
  });
  if (!attempt) {
    throw new IntegrationError(
      404,
      "attempt_not_found",
      "No dial with that reference was placed from this platform.",
    );
  }

  const mapped = STATUS_MAP[payload.status.trim().toLowerCase()] ?? {
    // An unknown status is not a failure: the call may well have happened. It
    // is recorded as it came, and the transcript decides the rest.
    state: "reached",
    call: "completed",
  };
  const transcript = flattenTranscript(payload.transcript);
  const reached = mapped.state === "reached";

  // Already recorded. The platform retries, and a retry must not create a
  // second call, a second promise or a second escalation.
  if (attempt.state !== "placed" && attempt.callId) {
    return {
      attemptId: attempt.id,
      suid: attempt.suid,
      state: attempt.state,
      callId: attempt.callId,
      duplicate: true,
    };
  }

  let callId: string | null = attempt.callId;
  let outcome = statedOutcome(payload.values);

  if (attempt.debtorId && reached) {
    // Through the same door every other call comes in by: analysis, promise,
    // escalation and the account's own status all happen there.
    const processed = await processCallCompleted(organizationId, apiKeyId, {
      externalCallId: payload.event_id?.trim() || `dial-${attempt.suid}`,
      debtorId: attempt.debtorId,
      campaignId: attempt.campaignId ?? undefined,
      direction: "outbound",
      startedAt: payload.started_at ?? attempt.requestedAt,
      endedAt: payload.ended_at,
      durationSeconds: payload.duration_seconds ?? 0,
      status: mapped.call as "completed",
      transcript,
      recordingUrl: payload.recording_url,
      outcome,
      externalAgentId: payload.agent,
    });
    callId = processed.callId;
    if (!processed.duplicate && "outcome" in processed && typeof processed.outcome === "string") {
      outcome = processed.outcome;
    }
  }

  const updated = await db.dialAttempt.update({
    where: { id: attempt.id },
    data: {
      state: mapped.state,
      answeredAt: reached ? (payload.started_at ?? new Date()) : null,
      endedAt: payload.ended_at ?? new Date(),
      durationSeconds: payload.duration_seconds ?? null,
      outcome: outcome ?? null,
      transcript: transcript ?? null,
      recordingUrl: payload.recording_url ?? null,
      callId,
      raw: JSON.stringify(payload),
    },
  });

  return {
    attemptId: updated.id,
    suid: updated.suid,
    state: updated.state,
    callId: updated.callId,
    duplicate: false,
  };
}
