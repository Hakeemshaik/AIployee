import type { CallOutcome } from "@/lib/domain";
import type { ProviderCall } from "../types";

// ---------------------------------------------------------------------------
// Provider result -> canonical internal outcome.
//
// Jobix reports a call status and (for connected calls) a result/structured
// payload. Both are mapped here onto the platform's own outcome vocabulary so
// dashboards, redial filters and reporting all speak one language.
//
// The map is configurable per organization (IntegrationSettings.outcomeMap);
// these are the defaults, and anything unrecognised falls through to the AI
// transcript analysis rather than being guessed.
// ---------------------------------------------------------------------------

export const DEFAULT_STATUS_MAP: Record<string, ProviderCall["status"]> = {
  completed: "completed",
  answered: "completed",
  finished: "completed",
  no_answer: "no_answer",
  "no-answer": "no_answer",
  noanswer: "no_answer",
  missed: "no_answer",
  busy: "busy",
  rejected: "busy",
  declined: "busy",
  voicemail: "voicemail",
  machine: "voicemail",
  failed: "failed",
  error: "failed",
  cancelled: "failed",
  canceled: "failed",
};

export const DEFAULT_OUTCOME_MAP: Record<string, CallOutcome> = {
  promise_to_pay: "promise_to_pay",
  ptp: "promise_to_pay",
  payment_promised: "promise_to_pay",
  payment_arrangement: "payment_arrangement",
  arrangement: "payment_arrangement",
  payment_plan: "payment_arrangement",
  payment_made: "paid_in_full_claimed",
  paid: "paid_in_full_claimed",
  already_paid: "paid_in_full_claimed",
  callback_requested: "callback_requested",
  callback: "callback_requested",
  call_back: "callback_requested",
  dispute: "dispute",
  disputed: "dispute",
  financial_hardship: "financial_hardship",
  hardship: "financial_hardship",
  cannot_afford: "financial_hardship",
  refused_to_pay: "refused_to_pay",
  refused: "refused_to_pay",
  wrong_number: "wrong_number",
  wrong_person: "wrong_number",
  third_party: "wrong_number",
  opted_out: "opted_out",
  do_not_call: "opted_out",
  no_commitment: "no_commitment",
  no_outcome: "no_commitment",
  other: "no_commitment",
  no_answer: "no_answer",
};

function normalizeKey(value: string): string {
  return value.trim().toLowerCase().replace(/[\s-]+/g, "_");
}

/** Map a provider status string onto an internal call status. */
export function mapStatus(
  raw: string | null | undefined,
  overrides: Record<string, string> = {},
): ProviderCall["status"] {
  if (!raw) return "failed";
  const key = normalizeKey(raw);
  const override = overrides[key];
  if (override && override in DEFAULT_STATUS_MAP) return DEFAULT_STATUS_MAP[override];
  return DEFAULT_STATUS_MAP[key] ?? "completed";
}

/**
 * Map a provider outcome/result onto an internal outcome.
 * Returns null when nothing matches — the caller then falls back to AI
 * transcript analysis instead of inventing an outcome.
 */
export function mapOutcome(
  raw: string | null | undefined,
  overrides: Record<string, string> = {},
): CallOutcome | null {
  if (!raw) return null;
  const key = normalizeKey(raw);
  const override = overrides[key];
  if (override && override in DEFAULT_OUTCOME_MAP) return DEFAULT_OUTCOME_MAP[override];
  return DEFAULT_OUTCOME_MAP[key] ?? null;
}

/** Pull the first present value for any of the given keys. */
export function pick<T = unknown>(source: Record<string, unknown>, keys: string[]): T | undefined {
  for (const key of keys) {
    const value = source[key];
    if (value !== undefined && value !== null && value !== "") return value as T;
  }
  return undefined;
}

export function toDate(value: unknown): Date | null {
  if (!value) return null;
  const d = new Date(String(value));
  return Number.isNaN(d.getTime()) ? null : d;
}
