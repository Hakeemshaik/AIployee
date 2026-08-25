// Canonical enumerated value sets for the platform.
// SQLite has no native enums, so these are the single source of truth —
// service-layer zod validation and UI labels both derive from here.

export const DEBTOR_STATUSES = [
  "active",
  "promise",
  "arrangement",
  "paid",
  "dispute",
  "hardship",
  "escalated",
  "uncontactable",
  "opted_out",
  "legal",
] as const;
export type DebtorStatus = (typeof DEBTOR_STATUSES)[number];

export const CAMPAIGN_STATUSES = ["draft", "scheduled", "active", "paused", "completed"] as const;
export type CampaignStatus = (typeof CAMPAIGN_STATUSES)[number];

export const CAMPAIGN_STRATEGIES = [
  "standard",
  "payment_plan_first",
  "early_settlement",
  "firm_reminder",
] as const;
export type CampaignStrategy = (typeof CAMPAIGN_STRATEGIES)[number];

export const CALL_STATUSES = ["completed", "no_answer", "busy", "voicemail", "failed"] as const;
export type CallStatus = (typeof CALL_STATUSES)[number];

export const CALL_OUTCOMES = [
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
  "no_answer",
] as const;
export type CallOutcome = (typeof CALL_OUTCOMES)[number];

export const SENTIMENTS = ["positive", "neutral", "negative"] as const;
export type Sentiment = (typeof SENTIMENTS)[number];

export const PROMISE_STATUSES = ["pending", "fulfilled", "broken", "cancelled"] as const;
export type PromiseStatus = (typeof PROMISE_STATUSES)[number];

/** Display status adds date-derived states on top of the stored status. */
export const PROMISE_DISPLAY_STATUSES = [
  "upcoming",
  "due_today",
  "overdue",
  "fulfilled",
  "broken",
  "cancelled",
] as const;
export type PromiseDisplayStatus = (typeof PROMISE_DISPLAY_STATUSES)[number];

export const PAYMENT_METHODS = ["eft", "debit_order", "card", "cash_deposit", "payment_link"] as const;
export type PaymentMethod = (typeof PAYMENT_METHODS)[number];

export const PAYMENT_STATUSES = ["completed", "pending", "reversed"] as const;

export const ESCALATION_REASONS = [
  "dispute",
  "legal_request",
  "financial_hardship",
  "vulnerable_customer",
  "angry_customer",
  "identity_issue",
  "ai_unable_to_resolve",
  "arrangement_outside_authority",
] as const;
export type EscalationReason = (typeof ESCALATION_REASONS)[number];

export const ESCALATION_PRIORITIES = ["low", "medium", "high", "urgent"] as const;
export const ESCALATION_STATUSES = ["open", "in_review", "assigned", "resolved"] as const;

export const REPORT_TYPES = [
  "daily",
  "weekly",
  "campaign",
  "agent_performance",
  "ptp",
  "recovery",
  "executive_summary",
] as const;
export type ReportType = (typeof REPORT_TYPES)[number];

export const AGENT_STATUSES = ["active", "paused", "offline"] as const;

export const EVENT_TYPES = [
  "call.completed",
  "call.analysed",
  "promise.created",
  "promise.fulfilled",
  "promise.broken",
  "payment.received",
  "debtor.escalated",
  "campaign.started",
  "campaign.completed",
  "sms.sent",
] as const;
export type PlatformEventType = (typeof EVENT_TYPES)[number];

// ---------------------------------------------------------------------------
// Human-readable labels
// ---------------------------------------------------------------------------

const LABELS: Record<string, string> = {
  // debtor statuses
  active: "Active",
  promise: "Promise to Pay",
  arrangement: "Arrangement",
  paid: "Paid",
  dispute: "Dispute",
  hardship: "Hardship",
  escalated: "Escalated",
  uncontactable: "Uncontactable",
  opted_out: "Opted Out",
  legal: "Legal",
  // campaign
  draft: "Draft",
  scheduled: "Scheduled",
  paused: "Paused",
  completed: "Completed",
  standard: "Standard",
  payment_plan_first: "Payment Plan First",
  early_settlement: "Early Settlement",
  firm_reminder: "Firm Reminder",
  // call statuses / outcomes
  no_answer: "No Answer",
  busy: "Busy",
  voicemail: "Voicemail",
  failed: "Failed",
  promise_to_pay: "Promise to Pay",
  payment_arrangement: "Payment Arrangement",
  paid_in_full_claimed: "Claims Paid",
  financial_hardship: "Financial Hardship",
  refused_to_pay: "Refused to Pay",
  wrong_number: "Wrong Number",
  callback_requested: "Callback Requested",
  no_commitment: "No Commitment",
  // sentiment
  positive: "Positive",
  neutral: "Neutral",
  negative: "Negative",
  // promises
  pending: "Pending",
  upcoming: "Upcoming",
  due_today: "Due Today",
  overdue: "Overdue",
  fulfilled: "Fulfilled",
  broken: "Broken",
  cancelled: "Cancelled",
  // payments
  eft: "EFT",
  debit_order: "Debit Order",
  card: "Card",
  cash_deposit: "Cash Deposit",
  payment_link: "Payment Link",
  reversed: "Reversed",
  // escalations
  legal_request: "Legal Request",
  vulnerable_customer: "Vulnerable Customer",
  angry_customer: "Angry Customer",
  identity_issue: "Identity Issue",
  ai_unable_to_resolve: "AI Unable to Resolve",
  arrangement_outside_authority: "Outside AI Authority",
  low: "Low",
  medium: "Medium",
  high: "High",
  urgent: "Urgent",
  open: "Open",
  in_review: "In Review",
  assigned: "Assigned",
  resolved: "Resolved",
  // reports
  daily: "Daily Collection Report",
  weekly: "Weekly Collection Report",
  campaign: "Campaign Report",
  agent_performance: "Agent Performance Report",
  ptp: "Promise-to-Pay Report",
  recovery: "Recovery Report",
  executive_summary: "Executive Summary",
  generating: "Generating",
  ready: "Ready",
  // agents
  offline: "Offline",
};

/** Convert a canonical snake_case value into its display label. */
export function label(value: string | null | undefined): string {
  if (!value) return "—";
  return LABELS[value] ?? value.replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

/** Risk band derived from the 0–100 risk score. */
export function riskBand(score: number): "low" | "medium" | "high" {
  if (score < 35) return "low";
  if (score < 65) return "medium";
  return "high";
}
