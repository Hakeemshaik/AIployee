import Anthropic from "@anthropic-ai/sdk";
import { mockProvider } from "./mock";
import type {
  AIProvider,
  CallAnalysisInput,
  CallExtraction,
  CollectionInsights,
  CollectionSnapshot,
  ReportNarrative,
} from "./types";

// ---------------------------------------------------------------------------
// Claude AI provider.
//
// Server-side only — the ANTHROPIC_API_KEY never reaches the client bundle.
// Every method asks Claude for a strict JSON payload matching the shapes in
// ./types and falls back to the deterministic mock provider on any failure,
// so an API outage degrades gracefully instead of breaking the pipeline.
// ---------------------------------------------------------------------------

const MODEL = process.env.ANTHROPIC_MODEL || "claude-opus-5";

let _client: Anthropic | null = null;
function client(): Anthropic {
  if (!_client) {
    _client = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY });
  }
  return _client;
}

/** Extract the first JSON object from a model response, tolerating fences. */
function parseJson<T>(text: string): T {
  const cleaned = text
    .replace(/^```(?:json)?\s*/m, "")
    .replace(/```\s*$/m, "")
    .trim();
  const start = cleaned.indexOf("{");
  const end = cleaned.lastIndexOf("}");
  if (start === -1 || end === -1) throw new Error("No JSON object in model response");
  return JSON.parse(cleaned.slice(start, end + 1)) as T;
}

async function ask<T>(system: string, user: string, maxTokens: number): Promise<T> {
  const response = await client().messages.create({
    model: MODEL,
    max_tokens: maxTokens,
    thinking: { type: "adaptive" },
    system,
    messages: [{ role: "user", content: user }],
  });
  const textBlock = response.content.find(
    (b): b is Anthropic.TextBlock => b.type === "text",
  );
  if (!textBlock) throw new Error(`No text in model response (stop: ${response.stop_reason})`);
  return parseJson<T>(textBlock.text);
}

const ANALYSIS_SYSTEM = `You are the call-analysis engine of a debt collection platform operating in South Africa (currency ZAR).
Analyse the call transcript and extract structured collection information.
Respond with ONLY a JSON object — no prose, no markdown fences — with exactly these keys:
{
  "outcome": one of "promise_to_pay" | "payment_arrangement" | "paid_in_full_claimed" | "dispute" | "financial_hardship" | "refused_to_pay" | "wrong_number" | "callback_requested" | "no_commitment" | "escalated" | "opted_out" | "no_answer",
  "promised_amount": number | null,
  "promised_date": "YYYY-MM-DD" | null,
  "payment_plan": { "installments": number, "amount_per_installment": number, "frequency": "weekly" | "monthly" } | null,
  "reason_for_nonpayment": string | null (short snake_case tag, e.g. "temporary_cash_flow"),
  "sentiment": "positive" | "neutral" | "negative",
  "sentiment_score": number between -1 and 1,
  "requires_human": boolean,
  "escalation_reason": string | null (one of: dispute, legal_request, financial_hardship, vulnerable_customer, angry_customer, identity_issue, ai_unable_to_resolve, arrangement_outside_authority),
  "next_action": string (short snake_case tag),
  "summary": string (2-3 sentences, factual),
  "key_points": string[] (3-5 short bullet points)
}
Be conservative: only record a promise when the debtor clearly committed to an amount and/or date. Flag requires_human=true for disputes, hardship, vulnerability signals, legal threats, or anything outside a collection AI's authority.`;

const INSIGHTS_SYSTEM = `You are the analytics engine of an AI debt collection platform. You receive aggregated, anonymised collection data (currency ZAR).
Generate honest, data-grounded insights — never invent numbers that are not derivable from the input, and never fabricate legal or compliance claims.
Respond with ONLY a JSON object — no prose, no markdown fences — with exactly these keys:
{
  "headline": string (one sentence),
  "collectionSummary": string (one paragraph),
  "keyFindings": [{ "title": string, "detail": string }],
  "riskTrends": [{ "title": string, "detail": string }],
  "debtorBehaviour": [{ "title": string, "detail": string }],
  "campaignPerformance": [{ "title": string, "detail": string }],
  "recommendedActions": [{ "title": string, "detail": string, "priority": "high" | "medium" | "low" }],
  "anomalies": [{ "title": string, "detail": string }]
}
2-4 items per array. Quote concrete figures from the data (rand values, percentages, counts).`;

const REPORT_SYSTEM = `You are the reporting engine of an AI debt collection platform. You receive a report type and aggregated collection data (currency ZAR).
Write the narrative sections of the report. Ground every statement in the supplied data; never invent figures or legal claims.
Respond with ONLY a JSON object — no prose, no markdown fences — with exactly these keys:
{
  "executiveSummary": string (one paragraph suitable for management),
  "insights": [{ "title": string, "detail": string }] (3-5 items),
  "recommendations": [{ "title": string, "detail": string, "priority": "high" | "medium" | "low" }] (3-4 items)
}`;

export const claudeProvider: AIProvider = {
  name: "claude",

  async analyzeCallTranscript(input: CallAnalysisInput): Promise<CallExtraction> {
    try {
      return await ask<CallExtraction>(
        ANALYSIS_SYSTEM,
        JSON.stringify({
          call_status: input.callStatus,
          reported_outcome: input.reportedOutcome ?? null,
          debtor: input.debtor,
          transcript: input.transcript,
        }),
        4000,
      );
    } catch (err) {
      console.error("[ai] Claude call analysis failed, using mock fallback:", err);
      return mockProvider.analyzeCallTranscript(input);
    }
  },

  async generateCollectionInsights(data: CollectionSnapshot): Promise<CollectionInsights> {
    try {
      return await ask<CollectionInsights>(INSIGHTS_SYSTEM, JSON.stringify(data), 8000);
    } catch (err) {
      console.error("[ai] Claude insight generation failed, using mock fallback:", err);
      return mockProvider.generateCollectionInsights(data);
    }
  },

  async generateReportNarrative(reportType: string, data: CollectionSnapshot): Promise<ReportNarrative> {
    try {
      return await ask<ReportNarrative>(
        REPORT_SYSTEM,
        JSON.stringify({ report_type: reportType, data }),
        8000,
      );
    } catch (err) {
      console.error("[ai] Claude report generation failed, using mock fallback:", err);
      return mockProvider.generateReportNarrative(reportType, data);
    }
  },
};
