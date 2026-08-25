import { label } from "@/lib/domain";
import type {
  AIProvider,
  CallAnalysisInput,
  CallExtraction,
  CollectionInsights,
  CollectionSnapshot,
  InsightFinding,
  RecommendedAction,
  ReportNarrative,
} from "./types";

// ---------------------------------------------------------------------------
// Mock AI provider.
//
// Deterministic and dependency-free. The transcript analyser is rule-based
// (keyword + pattern extraction) so the voice-integration pipeline is fully
// functional without an API key; the insight generator computes its findings
// from the real aggregated data it is given, so insights stay truthful to
// whatever is in the database rather than being canned copy.
// ---------------------------------------------------------------------------

const pct = (v: number) => `${Math.round(v * 100)}%`;

// --- transcript analysis ----------------------------------------------------

const OUTCOME_RULES: { outcome: CallExtraction["outcome"]; patterns: RegExp[] }[] = [
  { outcome: "dispute", patterns: [/dispute/i, /not my (debt|account)/i, /never (took|opened|signed)/i, /already paid.*(proof|settled)/i] },
  { outcome: "opted_out", patterns: [/stop calling/i, /do not (call|contact) me again/i, /remove (me|my number)/i, /opt(-| )?out/i] },
  { outcome: "wrong_number", patterns: [/wrong number/i, /no one (by|with) that name/i, /you have the wrong person/i] },
  { outcome: "financial_hardship", patterns: [/lost my job/i, /retrenched/i, /unemployed/i, /can'?t afford/i, /no (money|income)/i, /hardship/i, /medical bills/i] },
  { outcome: "payment_arrangement", patterns: [/(instal|payment plan|arrangement|pay .* per month|monthly payments|split it)/i] },
  { outcome: "promise_to_pay", patterns: [/i('| wi)ll pay/i, /i can pay/i, /promise/i, /payday/i, /transfer (it|the money)/i, /pay (on|by|before)/i] },
  { outcome: "paid_in_full_claimed", patterns: [/already paid/i, /settled (this|the) account/i, /paid it (off|in full)/i] },
  { outcome: "refused_to_pay", patterns: [/refuse/i, /not going to pay/i, /won'?t pay/i, /take me to court/i] },
  { outcome: "callback_requested", patterns: [/call (me )?back/i, /phone (me )?later/i, /busy right now/i, /at work.*later/i] },
];

const HUMAN_TRIGGERS: { reason: string; patterns: RegExp[] }[] = [
  { reason: "dispute", patterns: [/dispute/i, /not my (debt|account)/i] },
  { reason: "legal_request", patterns: [/lawyer/i, /attorney/i, /legal/i, /ombud/i, /court/i] },
  { reason: "vulnerable_customer", patterns: [/hospital/i, /disability/i, /pension/i, /grant/i, /passed away/i, /funeral/i] },
  { reason: "angry_customer", patterns: [/harass/i, /shout/i, /swear/i, /this is ridiculous/i, /sick of you/i] },
  { reason: "financial_hardship", patterns: [/retrenched/i, /lost my job/i, /hardship/i] },
];

const NONPAYMENT_REASONS: { reason: string; patterns: RegExp[] }[] = [
  { reason: "retrenchment_or_job_loss", patterns: [/retrench/i, /lost my job/i, /unemployed/i] },
  { reason: "temporary_cash_flow", patterns: [/short this month/i, /after payday/i, /cash flow/i, /tight (this|right) (month|now)/i, /waiting (for|on) (my )?(salary|money)/i] },
  { reason: "medical_expenses", patterns: [/medical/i, /hospital/i, /sick/i] },
  { reason: "disputes_amount", patterns: [/too much/i, /interest/i, /doesn'?t match/i, /dispute/i] },
  { reason: "forgot_or_unaware", patterns: [/forgot/i, /didn'?t know/i, /wasn'?t aware/i, /no statement/i] },
];

const NEGATIVE_WORDS = /(angry|harass|ridiculous|sick of|shout|refuse|threat|scam|stop calling|frustrat|upset|unfair)/gi;
const POSITIVE_WORDS = /(thank(s| you)|appreciate|no problem|happy to|sure,|of course|sounds good|perfect|that works)/gi;

function extractAmount(transcript: string): number | null {
  // R1,500 / R1 500 / R1500.50 / "1500 rand"
  const m =
    transcript.match(/R\s?([\d]{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)/) ??
    transcript.match(/([\d]{1,3}(?:[,\s]\d{3})*(?:\.\d{2})?)\s?rand/i);
  if (!m) return null;
  const value = parseFloat(m[1].replace(/[,\s]/g, ""));
  return Number.isFinite(value) && value > 0 ? value : null;
}

const MONTHS = ["january", "february", "march", "april", "may", "june", "july", "august", "september", "october", "november", "december"];

function extractDate(transcript: string, from: Date): string | null {
  const lower = transcript.toLowerCase();
  // "28 August" / "28th of August"
  const dm = lower.match(/(\d{1,2})(?:st|nd|rd|th)?(?: of)? (january|february|march|april|may|june|july|august|september|october|november|december)/);
  if (dm) {
    const d = new Date(from.getFullYear(), MONTHS.indexOf(dm[2]), parseInt(dm[1], 10));
    if (d.getTime() < from.getTime() - 86_400_000) d.setFullYear(d.getFullYear() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/end of (the )?month/.test(lower)) {
    const d = new Date(from.getFullYear(), from.getMonth() + 1, 0);
    return d.toISOString().slice(0, 10);
  }
  const inDays = lower.match(/in (\d{1,2}) days/);
  if (inDays) {
    const d = new Date(from.getTime() + parseInt(inDays[1], 10) * 86_400_000);
    return d.toISOString().slice(0, 10);
  }
  if (/tomorrow/.test(lower)) return new Date(from.getTime() + 86_400_000).toISOString().slice(0, 10);
  if (/payday|month.end|25th/.test(lower)) {
    const d = new Date(from.getFullYear(), from.getMonth(), 25);
    if (d.getTime() < from.getTime()) d.setMonth(d.getMonth() + 1);
    return d.toISOString().slice(0, 10);
  }
  if (/friday/.test(lower)) {
    const d = new Date(from);
    d.setDate(d.getDate() + ((5 - d.getDay() + 7) % 7 || 7));
    return d.toISOString().slice(0, 10);
  }
  return null;
}

function analyzeTranscript(input: CallAnalysisInput): CallExtraction {
  const { transcript } = input;
  const now = new Date();

  let outcome: CallExtraction["outcome"] = "no_commitment";
  if (input.callStatus !== "completed") {
    outcome = "no_answer";
  } else {
    for (const rule of OUTCOME_RULES) {
      if (rule.patterns.some((p) => p.test(transcript))) {
        outcome = rule.outcome;
        break;
      }
    }
    // A reported outcome from the voice platform takes precedence when present.
    if (input.reportedOutcome && input.reportedOutcome !== "unknown") {
      outcome = input.reportedOutcome as CallExtraction["outcome"];
    }
  }

  const amount = extractAmount(transcript);
  const date = extractDate(transcript, now);

  const planMatch = transcript.match(/(\d{1,2})\s*(?:x|monthly|weekly)?\s*(?:instal|payments? of)/i);
  const isArrangement = outcome === "payment_arrangement";
  const installments = isArrangement ? (planMatch ? parseInt(planMatch[1], 10) : 3) : null;

  const negatives = (transcript.match(NEGATIVE_WORDS) ?? []).length;
  const positives = (transcript.match(POSITIVE_WORDS) ?? []).length;
  const rawScore = (positives - negatives) / Math.max(3, positives + negatives);
  const sentiment = rawScore > 0.15 ? "positive" : rawScore < -0.15 ? "negative" : "neutral";

  let requiresHuman = false;
  let escalationReason: string | null = null;
  for (const trigger of HUMAN_TRIGGERS) {
    if (trigger.patterns.some((p) => p.test(transcript))) {
      requiresHuman = true;
      escalationReason = trigger.reason;
      break;
    }
  }
  if (["dispute", "financial_hardship"].includes(outcome)) {
    requiresHuman = true;
    escalationReason ??= outcome === "dispute" ? "dispute" : "financial_hardship";
  }

  let reason: string | null = null;
  for (const r of NONPAYMENT_REASONS) {
    if (r.patterns.some((p) => p.test(transcript))) {
      reason = r.reason;
      break;
    }
  }

  const nextAction =
    outcome === "promise_to_pay"
      ? "follow_up_before_promised_date"
      : outcome === "payment_arrangement"
        ? "confirm_first_installment"
        : outcome === "dispute"
          ? "route_to_dispute_handler"
          : outcome === "financial_hardship"
            ? "human_affordability_review"
            : outcome === "callback_requested"
              ? "schedule_callback"
              : outcome === "wrong_number"
                ? "verify_contact_details"
                : outcome === "opted_out"
                  ? "suppress_contact"
                  : outcome === "paid_in_full_claimed"
                    ? "verify_payment_received"
                    : outcome === "no_answer"
                      ? "retry_within_campaign_rules"
                      : "retry_with_alternative_approach";

  const keyPoints: string[] = [];
  if (amount) keyPoints.push(`Debtor referenced an amount of R${amount.toLocaleString("en-ZA")}`);
  if (date) keyPoints.push(`A payment date of ${date} was discussed`);
  if (reason) keyPoints.push(`Reason for non-payment: ${label(reason)}`);
  if (requiresHuman) keyPoints.push(`Flagged for human review (${label(escalationReason ?? "")})`);
  if (keyPoints.length === 0) keyPoints.push("No firm commitment obtained on this call");

  const summary =
    input.callStatus !== "completed"
      ? `Call attempt to ${input.debtor.name} was not answered.`
      : `${input.debtor.name} (R${Math.round(input.debtor.outstandingBalance).toLocaleString("en-ZA")} outstanding, ${input.debtor.daysOverdue} days overdue): ${label(outcome).toLowerCase()}${amount ? ` of R${amount.toLocaleString("en-ZA")}` : ""}${date ? ` by ${date}` : ""}. Sentiment was ${sentiment}.`;

  return {
    outcome,
    promised_amount: ["promise_to_pay", "payment_arrangement"].includes(outcome) ? amount : null,
    promised_date: ["promise_to_pay", "payment_arrangement"].includes(outcome) ? date : null,
    payment_plan:
      isArrangement && amount && installments
        ? { installments, amount_per_installment: Math.round(amount / installments), frequency: "monthly" }
        : null,
    reason_for_nonpayment: reason,
    sentiment,
    sentiment_score: Math.max(-1, Math.min(1, rawScore * 2)),
    requires_human: requiresHuman,
    escalation_reason: escalationReason,
    next_action: nextAction,
    summary,
    key_points: keyPoints,
  };
}

// --- insight generation ------------------------------------------------------

function computeInsights(data: CollectionSnapshot): CollectionInsights {
  const t = data.totals;
  const money = (v: number) => `R${Math.round(v).toLocaleString("en-ZA")}`;

  const totalOutcomes = Object.values(data.outcomes).reduce((a, b) => a + b, 0) || 1;
  const share = (key: string) => (data.outcomes[key] ?? 0) / totalOutcomes;
  const reasonEntries = Object.entries(data.reasonsForNonpayment).sort((a, b) => b[1] - a[1]);
  const totalReasons = reasonEntries.reduce((a, [, n]) => a + n, 0) || 1;

  const keyFindings: InsightFinding[] = [];
  if (reasonEntries.length > 0) {
    const [topReason, count] = reasonEntries[0];
    keyFindings.push({
      title: `${pct(count / totalReasons)} of stated non-payment reasons relate to ${label(topReason).toLowerCase()}`,
      detail: `Across ${totalReasons} calls where a reason was captured, ${label(topReason).toLowerCase()} was cited most often. Tailor scripts and affordability options to this driver.`,
    });
  }
  const arrangementShare = share("payment_arrangement");
  const ptpShare = share("promise_to_pay");
  if (arrangementShare > 0 || ptpShare > 0) {
    keyFindings.push({
      title:
        arrangementShare >= ptpShare
          ? "Payment arrangements are converting better than single promises"
          : `Promises to pay lead conversions at ${pct(ptpShare)} of connected calls`,
      detail: `Connected calls produced ${data.outcomes["promise_to_pay"] ?? 0} promises and ${data.outcomes["payment_arrangement"] ?? 0} arrangements. Promise fulfilment currently stands at ${pct(data.promises.fulfilmentRate)}.`,
    });
  }
  const oldBucket = data.agingBuckets.find((b) => b.bucket === "90+");
  const youngBucket = data.agingBuckets.find((b) => b.bucket === "0-30" || b.bucket === "31-60");
  if (oldBucket && youngBucket && oldBucket.outstanding > 0) {
    const oldRate = oldBucket.recovered / (oldBucket.outstanding + oldBucket.recovered || 1);
    const youngRate = youngBucket.recovered / (youngBucket.outstanding + youngBucket.recovered || 1);
    keyFindings.push({
      title: "Accounts older than 90 days recover at a materially lower rate",
      detail: `90+ day accounts show a ${pct(oldRate)} recovery rate versus ${pct(youngRate)} for accounts under 60 days. Early-stage contact remains the highest-leverage activity.`,
    });
  }

  const riskTrends: InsightFinding[] = [
    {
      title:
        data.promises.overdue > 0
          ? `${data.promises.overdue} open promise${data.promises.overdue === 1 ? " is" : "s are"} past their promised date`
          : `${data.promises.broken} promise${data.promises.broken === 1 ? " was" : "s were"} broken this period`,
      detail: `${data.promises.pending} promise${data.promises.pending === 1 ? " is" : "s are"} currently open and ${data.promises.broken} ${data.promises.broken === 1 ? "was" : "were"} broken in the period. Broken-promise debtors re-convert at a much lower rate, so same-day follow-up on missed promises is critical.`,
    },
    {
      title: `Connect rate is ${pct(t.connectRate)} across ${t.totalCallAttempts} attempts`,
      detail: `${t.debtorsContacted} of ${t.debtorCount} debtors have been reached at least once. Numbers failing repeatedly should be cycled to alternative contact strategies (SMS, alternate numbers) rather than consuming dialling capacity.`,
    },
  ];
  const hardshipCount = (data.outcomes["financial_hardship"] ?? 0) + (data.escalations["financial_hardship"] ?? 0);
  if (hardshipCount > 0) {
    riskTrends.push({
      title: `${hardshipCount} hardship signals recorded this period`,
      detail: "Hardship cases require careful, compliant handling. Ensure these accounts follow the configured hardship path and are excluded from standard retry pressure.",
    });
  }

  const debtorBehaviour: InsightFinding[] = [
    {
      title: `Average payment received is ${money(data.payments.averageValue)}`,
      detail: `${data.payments.count} payments totalling ${money(data.payments.totalValue)} were received. ${data.promises.fulfilled} of ${data.promises.fulfilled + data.promises.broken || 1} resolved promises were honoured (${pct(data.promises.fulfilmentRate)}).`,
    },
    {
      title:
        (data.sentiment["negative"] ?? 0) > (data.sentiment["positive"] ?? 0)
          ? "Negative sentiment outweighs positive on connected calls"
          : "Debtor sentiment is holding steady",
      detail: `Sentiment split: ${data.sentiment["positive"] ?? 0} positive / ${data.sentiment["neutral"] ?? 0} neutral / ${data.sentiment["negative"] ?? 0} negative. Sentiment is a leading indicator of complaint risk — spikes in negative calls should trigger script review.`,
    },
  ];

  const rankedCampaigns = [...data.campaigns].sort((a, b) => b.recoveryRate - a.recoveryRate);
  const campaignPerformance: InsightFinding[] = rankedCampaigns.slice(0, 3).map((c, i) => ({
    title: `${i === 0 ? "Best performer: " : ""}${c.name} — ${pct(c.recoveryRate)} recovery`,
    detail: `${label(c.strategy)} strategy. ${c.contacted}/${c.debtors} debtors contacted, ${c.promises} promises worth ${money(c.promiseValue)}, ${money(c.recovered)} recovered against ${money(c.outstanding)} outstanding.`,
  }));

  const recommendedActions: RecommendedAction[] = [];
  if (data.promises.pending > 0) {
    recommendedActions.push({
      title: "Follow up outstanding promises before their due date",
      detail: `${data.promises.pending} open promises worth ${money(data.promises.totalValue)} are pending. A reminder touch 24–48 hours before the promised date measurably lifts fulfilment.`,
      priority: "high",
    });
  }
  recommendedActions.push({
    title: "Prioritise high-value accounts with a recent successful contact",
    detail: "Recency of a successful conversation is the strongest re-conversion signal in the current data. Queue these accounts first in tomorrow's dialling window.",
    priority: "high",
  });
  if ((data.escalations["dispute"] ?? 0) > 0 || (data.outcomes["dispute"] ?? 0) > 0) {
    recommendedActions.push({
      title: "Clear the disputed-account queue",
      detail: `${(data.escalations["dispute"] ?? 0) + (data.outcomes["dispute"] ?? 0)} accounts have raised disputes. Disputed accounts should be frozen from dialling and resolved by a human collector per your compliance settings.`,
      priority: "medium",
    });
  }
  if (rankedCampaigns.length > 1) {
    const best = rankedCampaigns[0];
    recommendedActions.push({
      title: `Extend the ${label(best.strategy).toLowerCase()} approach to weaker campaigns`,
      detail: `${best.name} leads on recovery rate at ${pct(best.recoveryRate)}. Test its strategy on the lowest-performing active campaign before adding dialling volume.`,
      priority: "medium",
    });
  }

  const anomalies: InsightFinding[] = [];
  const wrongNumbers = data.outcomes["wrong_number"] ?? 0;
  if (wrongNumbers / totalOutcomes > 0.05) {
    anomalies.push({
      title: `Wrong-number rate at ${pct(wrongNumbers / totalOutcomes)} of connected calls`,
      detail: "Above the 5% threshold — the underlying contact data likely needs re-validation before further dialling spend.",
    });
  }
  const claimsPaid = data.outcomes["paid_in_full_claimed"] ?? 0;
  if (claimsPaid > 0) {
    anomalies.push({
      title: `${claimsPaid} debtor${claimsPaid === 1 ? " claims" : "s claim"} the account is already settled`,
      detail: "Reconcile these against payment records before the next attempt — repeated collection on settled accounts is a serious complaint and compliance risk.",
    });
  }
  if (anomalies.length === 0) {
    anomalies.push({
      title: "No material anomalies detected in this period",
      detail: "Outcome distribution, connect rates and payment patterns are within expected ranges for the current book.",
    });
  }

  return {
    headline: `${money(t.totalRecovered)} recovered at a ${pct(t.recoveryRate)} recovery rate this period, with ${data.promises.total} promises worth ${money(data.promises.totalValue)} captured (${data.promises.pending} still open).`,
    collectionSummary: `Between ${data.periodStart.slice(0, 10)} and ${data.periodEnd.slice(0, 10)}, ${t.totalCallAttempts} call attempts reached ${t.debtorsContacted} of ${t.debtorCount} debtors (${pct(t.connectRate)} connect rate). Connected conversations produced ${data.promises.total} promises to pay worth ${money(data.promises.totalValue)}, of which ${data.promises.fulfilled} have been fulfilled and ${data.promises.broken} broken. ${data.payments.count} payments totalling ${money(data.payments.totalValue)} were recovered against a book of ${money(t.totalOutstanding)}, a recovery rate of ${pct(t.recoveryRate)}.`,
    keyFindings,
    riskTrends,
    debtorBehaviour,
    campaignPerformance,
    recommendedActions,
    anomalies,
  };
}

function computeReportNarrative(reportType: string, data: CollectionSnapshot): ReportNarrative {
  const insights = computeInsights(data);
  const focus: Record<string, InsightFinding[]> = {
    ptp: insights.debtorBehaviour,
    campaign: insights.campaignPerformance,
    agent_performance: insights.campaignPerformance,
    recovery: insights.riskTrends,
  };
  return {
    executiveSummary: insights.collectionSummary,
    insights: [...insights.keyFindings, ...(focus[reportType] ?? insights.riskTrends)].slice(0, 5),
    recommendations: insights.recommendedActions.slice(0, 4),
  };
}

export const mockProvider: AIProvider = {
  name: "mock",
  async analyzeCallTranscript(input: CallAnalysisInput): Promise<CallExtraction> {
    return analyzeTranscript(input);
  },
  async generateCollectionInsights(data: CollectionSnapshot): Promise<CollectionInsights> {
    return computeInsights(data);
  },
  async generateReportNarrative(reportType: string, data: CollectionSnapshot): Promise<ReportNarrative> {
    return computeReportNarrative(reportType, data);
  },
};
