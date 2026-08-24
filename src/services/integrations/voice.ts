import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { CALL_STATUSES, ESCALATION_REASONS } from "@/lib/domain";
import { getAIProvider } from "@/services/ai";

// ---------------------------------------------------------------------------
// Voice platform integration — the inbound pipeline for completed calls.
//
// POST /api/integrations/voice/call-completed → processCallCompleted()
//
//  1. validate the payload (zod)
//  2. resolve debtor / campaign / agent inside the authenticated org
//  3. store the call (idempotent on externalCallId)
//  4. emit call.completed
//  5. run AI transcript analysis and store CallAnalysis
//  6. emit call.analysed
//  7. create a promise to pay if one was extracted → promise.created
//  8. create an escalation if the AI flags a human hand-off → debtor.escalated
//  9. update the debtor's contact state, status and risk score
// 10. audit-log the ingestion (ids only — no transcript content)
//
// Campaign metrics and reporting read models are computed from this stored
// data, so they update automatically.
// ---------------------------------------------------------------------------

export const callCompletedSchema = z.object({
  externalCallId: z.string().min(1).max(120),
  // The voice platform can reference the debtor by our id, account number, or
  // phone number — at least one is required.
  debtorId: z.string().optional(),
  accountNumber: z.string().optional(),
  phone: z.string().optional(),
  agentId: z.string().optional(),
  externalAgentId: z.string().optional(),
  campaignId: z.string().optional(),
  direction: z.enum(["outbound", "inbound"]).default("outbound"),
  startedAt: z.coerce.date(),
  endedAt: z.coerce.date().optional(),
  durationSeconds: z.coerce.number().int().min(0).max(24 * 3600).default(0),
  status: z.enum(CALL_STATUSES).default("completed"),
  transcript: z.string().max(200_000).optional(),
  recordingUrl: z.string().url().max(2000).optional(),
  outcome: z.string().max(60).optional(),
});

export type CallCompletedPayload = z.infer<typeof callCompletedSchema>;

export async function processCallCompleted(
  organizationId: string,
  apiKeyId: string,
  payload: CallCompletedPayload,
) {
  // --- resolve entities, always scoped to the authenticated organization ---
  const debtor = await db.debtor.findFirst({
    where: {
      organizationId,
      OR: [
        ...(payload.debtorId ? [{ id: payload.debtorId }] : []),
        ...(payload.accountNumber ? [{ accountNumber: payload.accountNumber }] : []),
        ...(payload.phone ? [{ phone: payload.phone }] : []),
      ],
    },
    include: { accounts: true },
  });
  if (!debtor) {
    throw new IntegrationError(404, "debtor_not_found", "No matching debtor in this organization");
  }

  const agent = payload.agentId || payload.externalAgentId
    ? await db.aIAgent.findFirst({
        where: {
          organizationId,
          OR: [
            ...(payload.agentId ? [{ id: payload.agentId }] : []),
            ...(payload.externalAgentId ? [{ externalId: payload.externalAgentId }] : []),
          ],
        },
      })
    : null;

  const campaign = payload.campaignId
    ? await db.campaign.findFirst({ where: { id: payload.campaignId, organizationId } })
    : debtor.campaignId
      ? await db.campaign.findFirst({ where: { id: debtor.campaignId, organizationId } })
      : null;

  // --- idempotent call storage ---
  const existing = await db.call.findFirst({
    where: { organizationId, externalCallId: payload.externalCallId },
  });
  if (existing) {
    return { callId: existing.id, duplicate: true as const };
  }

  const call = await db.call.create({
    data: {
      organizationId,
      externalCallId: payload.externalCallId,
      debtorId: debtor.id,
      campaignId: campaign?.id,
      agentId: agent?.id,
      direction: payload.direction,
      startedAt: payload.startedAt,
      endedAt: payload.endedAt,
      durationSeconds: payload.durationSeconds,
      status: payload.status,
      outcome: payload.outcome,
      transcript: payload.transcript,
      recordingUrl: payload.recordingUrl,
    },
  });

  await emitEvent({
    type: "call.completed",
    organizationId,
    entityType: "call",
    entityId: call.id,
    payload: {
      externalCallId: payload.externalCallId,
      debtorId: debtor.id,
      status: payload.status,
      durationSeconds: payload.durationSeconds,
    },
  });

  // --- AI transcript analysis ---
  const outstanding = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
  const daysOverdue = Math.max(0, ...debtor.accounts.map((a) => a.daysOverdue));
  const provider = await getAIProvider();
  const extraction = await provider.analyzeCallTranscript({
    transcript: payload.transcript ?? "",
    callStatus: payload.status,
    reportedOutcome: payload.outcome,
    debtor: {
      name: `${debtor.firstName} ${debtor.lastName}`,
      outstandingBalance: outstanding,
      daysOverdue,
    },
  });

  const analysis = await db.callAnalysis.create({
    data: {
      organizationId,
      callId: call.id,
      outcome: extraction.outcome,
      promisedAmount: extraction.promised_amount,
      promisedDate: extraction.promised_date ? new Date(extraction.promised_date) : null,
      paymentPlan: extraction.payment_plan ? JSON.stringify(extraction.payment_plan) : null,
      reasonForNonpayment: extraction.reason_for_nonpayment,
      sentiment: extraction.sentiment,
      sentimentScore: extraction.sentiment_score,
      requiresHuman: extraction.requires_human,
      escalationReason: extraction.escalation_reason,
      nextAction: extraction.next_action,
      summary: extraction.summary,
      keyPoints: JSON.stringify(extraction.key_points),
      provider: provider.name,
    },
  });

  await emitEvent({
    type: "call.analysed",
    organizationId,
    entityType: "call",
    entityId: call.id,
    payload: { outcome: extraction.outcome, requiresHuman: extraction.requires_human },
  });

  // --- promise creation ---
  let promiseId: string | null = null;
  if (
    ["promise_to_pay", "payment_arrangement"].includes(extraction.outcome) &&
    extraction.promised_amount &&
    extraction.promised_amount > 0
  ) {
    const promise = await db.promiseToPay.create({
      data: {
        organizationId,
        debtorId: debtor.id,
        campaignId: campaign?.id,
        callId: call.id,
        amount: extraction.promised_amount,
        promisedDate: extraction.promised_date
          ? new Date(extraction.promised_date)
          : new Date(Date.now() + 7 * 86_400_000),
        paymentPlan: extraction.payment_plan ? JSON.stringify(extraction.payment_plan) : null,
        status: "pending",
      },
    });
    promiseId = promise.id;
    await emitEvent({
      type: "promise.created",
      organizationId,
      entityType: "promise",
      entityId: promise.id,
      payload: { debtorId: debtor.id, amount: promise.amount, promisedDate: promise.promisedDate.toISOString() },
    });
  }

  // --- escalation ---
  let escalationId: string | null = null;
  if (extraction.requires_human) {
    const reason = ESCALATION_REASONS.includes(
      extraction.escalation_reason as (typeof ESCALATION_REASONS)[number],
    )
      ? (extraction.escalation_reason as string)
      : "ai_unable_to_resolve";
    const escalation = await db.escalation.create({
      data: {
        organizationId,
        debtorId: debtor.id,
        callId: call.id,
        campaignId: campaign?.id,
        reason,
        priority: ["legal_request", "vulnerable_customer"].includes(reason)
          ? "urgent"
          : ["dispute", "angry_customer"].includes(reason)
            ? "high"
            : "medium",
        status: "open",
        notes: extraction.summary,
      },
    });
    escalationId = escalation.id;
    await emitEvent({
      type: "debtor.escalated",
      organizationId,
      entityType: "escalation",
      entityId: escalation.id,
      payload: { debtorId: debtor.id, reason },
    });
  }

  // --- debtor state update ---
  const statusByOutcome: Record<string, string> = {
    promise_to_pay: "promise",
    payment_arrangement: "arrangement",
    dispute: "dispute",
    financial_hardship: "hardship",
    opted_out: "opted_out",
  };
  const riskDelta: Record<string, number> = {
    promise_to_pay: -8,
    payment_arrangement: -10,
    paid_in_full_claimed: -5,
    refused_to_pay: 12,
    no_commitment: 3,
    no_answer: 2,
    dispute: 5,
    financial_hardship: 8,
  };
  await db.debtor.update({
    where: { id: debtor.id },
    data: {
      lastContactAt: payload.startedAt,
      lastOutcome: extraction.outcome,
      status: escalationId
        ? "escalated"
        : (statusByOutcome[extraction.outcome] ?? debtor.status),
      riskScore: Math.max(
        0,
        Math.min(100, debtor.riskScore + (riskDelta[extraction.outcome] ?? 0)),
      ),
      ...(extraction.outcome === "opted_out" ? { doNotContact: true } : {}),
    },
  });

  await audit({
    organizationId,
    actorType: "integration",
    actorId: apiKeyId,
    action: "call.ingested",
    entityType: "call",
    entityId: call.id,
    detail: {
      externalCallId: payload.externalCallId,
      outcome: extraction.outcome,
      promiseId,
      escalationId,
      provider: provider.name,
    },
  });

  return {
    callId: call.id,
    duplicate: false as const,
    analysisId: analysis.id,
    outcome: extraction.outcome,
    promiseId,
    escalationId,
    requiresHuman: extraction.requires_human,
    nextAction: extraction.next_action,
  };
}

export class IntegrationError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
  }
}
