import type { CallOutcome, Sentiment } from "@/lib/domain";

// ---------------------------------------------------------------------------
// AI provider abstraction.
//
// The application never talks to a specific model directly — everything goes
// through the AIProvider interface. `mock` is a deterministic, rule-based
// implementation that works with no external dependencies; `claude` calls the
// Anthropic API. Set AI_PROVIDER in the environment to switch. New providers
// (or model upgrades) are additions to src/services/ai only.
// ---------------------------------------------------------------------------

/** Structured information extracted from a call transcript. */
export type CallExtraction = {
  outcome: CallOutcome;
  promised_amount: number | null;
  promised_date: string | null; // ISO date
  payment_plan: {
    installments: number;
    amount_per_installment: number;
    frequency: "weekly" | "monthly";
  } | null;
  reason_for_nonpayment: string | null;
  sentiment: Sentiment;
  sentiment_score: number; // -1 .. 1
  requires_human: boolean;
  escalation_reason: string | null;
  next_action: string;
  summary: string;
  key_points: string[];
};

export type CallAnalysisInput = {
  transcript: string;
  callStatus: string;
  reportedOutcome?: string | null;
  debtor: {
    name: string;
    outstandingBalance: number;
    daysOverdue: number;
  };
};

/** Aggregated, anonymised collection data handed to the AI for analysis. */
export type CollectionSnapshot = {
  organizationName: string;
  currency: string;
  periodStart: string;
  periodEnd: string;
  totals: {
    totalOutstanding: number;
    totalRecovered: number;
    recoveryRate: number; // 0..1
    debtorCount: number;
    debtorsContacted: number;
    successfulContacts: number;
    totalCallAttempts: number;
    connectRate: number; // 0..1
  };
  outcomes: Record<string, number>; // canonical outcome -> count
  reasonsForNonpayment: Record<string, number>;
  sentiment: Record<string, number>;
  promises: {
    total: number;
    totalValue: number;
    fulfilled: number;
    broken: number;
    pending: number;
    overdue: number;
    fulfilmentRate: number; // 0..1 of resolved promises
  };
  payments: {
    count: number;
    totalValue: number;
    averageValue: number;
  };
  agingBuckets: {
    bucket: string; // "0-30" | "31-60" | "61-90" | "90+"
    debtors: number;
    outstanding: number;
    recovered: number;
    contactRate: number;
  }[];
  campaigns: {
    name: string;
    status: string;
    strategy: string;
    debtors: number;
    contacted: number;
    connected: number;
    promises: number;
    promiseValue: number;
    recovered: number;
    outstanding: number;
    recoveryRate: number;
  }[];
  escalations: Record<string, number>; // reason -> count
};

export type InsightFinding = { title: string; detail: string };
export type RecommendedAction = {
  title: string;
  detail: string;
  priority: "high" | "medium" | "low";
};

/** Structured output of generateCollectionInsights(). */
export type CollectionInsights = {
  headline: string;
  collectionSummary: string;
  keyFindings: InsightFinding[];
  riskTrends: InsightFinding[];
  debtorBehaviour: InsightFinding[];
  campaignPerformance: InsightFinding[];
  recommendedActions: RecommendedAction[];
  anomalies: InsightFinding[];
};

export type ReportNarrative = {
  executiveSummary: string;
  insights: InsightFinding[];
  recommendations: RecommendedAction[];
};

export interface AIProvider {
  readonly name: "mock" | "claude";
  /** Extract structured collection information from a call transcript. */
  analyzeCallTranscript(input: CallAnalysisInput): Promise<CallExtraction>;
  /** Generate insights, findings and recommendations from aggregated data. */
  generateCollectionInsights(data: CollectionSnapshot): Promise<CollectionInsights>;
  /** Generate the narrative sections of a report from aggregated data. */
  generateReportNarrative(reportType: string, data: CollectionSnapshot): Promise<ReportNarrative>;
}
