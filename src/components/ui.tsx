import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared UI primitives — server-safe, no client JS.
// ---------------------------------------------------------------------------

export function PageHeader({
  title,
  description,
  actions,
}: {
  title: string;
  description?: string;
  actions?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold tracking-tight text-ink">{title}</h1>
        {description && <p className="mt-1 max-w-2xl text-[0.8125rem] text-ink-2">{description}</p>}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

export function GlassCard({
  title,
  subtitle,
  actions,
  children,
  className = "",
  pad = true,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
}) {
  return (
    <section className={`glass ${pad ? "p-5" : ""} ${className}`}>
      {(title || actions) && (
        <div className={`flex items-start justify-between gap-3 ${pad ? "mb-4" : "p-5 pb-4"}`}>
          <div>
            {title && <h2 className="text-[0.9375rem] font-semibold tracking-tight text-ink">{title}</h2>}
            {subtitle && <p className="mt-0.5 text-[0.75rem] text-ink-3">{subtitle}</p>}
          </div>
          {actions}
        </div>
      )}
      {children}
    </section>
  );
}

export function StatCard({
  label,
  value,
  sub,
  tone,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "critical" | "accent";
}) {
  const valueColor =
    tone === "good" ? "text-[#35c06f]" : tone === "critical" ? "text-[#e57373]" : "text-ink";
  return (
    <div className="glass-subtle px-4 py-3.5">
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">{label}</p>
      <p className={`mt-1.5 text-[1.375rem] font-semibold leading-none tracking-tight ${valueColor}`}>
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[0.71875rem] text-ink-3">{sub}</p>}
    </div>
  );
}

// --- status badge -----------------------------------------------------------

type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical" | "violet";

const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.05] text-ink-2",
  info: "border-[rgba(57,135,229,0.35)] bg-[rgba(57,135,229,0.12)] text-[#7fb3ef]",
  good: "border-[rgba(12,163,12,0.35)] bg-[rgba(12,163,12,0.12)] text-[#5fc46a]",
  warning: "border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.1)] text-[#f2c14e]",
  serious: "border-[rgba(236,131,90,0.35)] bg-[rgba(236,131,90,0.12)] text-[#f0a17e]",
  critical: "border-[rgba(208,59,59,0.35)] bg-[rgba(208,59,59,0.12)] text-[#ec8181]",
  violet: "border-[rgba(144,133,233,0.35)] bg-[rgba(144,133,233,0.12)] text-[#aaa2ef]",
};

const STATUS_TONES: Record<string, Tone> = {
  // debtor / general
  active: "info",
  promise: "violet",
  arrangement: "violet",
  paid: "good",
  dispute: "serious",
  hardship: "serious",
  escalated: "critical",
  uncontactable: "neutral",
  opted_out: "neutral",
  legal: "critical",
  // campaign
  draft: "neutral",
  scheduled: "info",
  paused: "warning",
  completed: "good",
  // calls
  no_answer: "neutral",
  busy: "neutral",
  voicemail: "neutral",
  failed: "critical",
  promise_to_pay: "good",
  payment_arrangement: "violet",
  paid_in_full_claimed: "warning",
  financial_hardship: "serious",
  refused_to_pay: "critical",
  wrong_number: "neutral",
  callback_requested: "info",
  no_commitment: "neutral",
  // sentiment
  positive: "good",
  neutral: "neutral",
  negative: "critical",
  // promises
  pending: "info",
  upcoming: "info",
  due_today: "warning",
  overdue: "critical",
  fulfilled: "good",
  broken: "critical",
  cancelled: "neutral",
  // payments
  reversed: "critical",
  // escalations
  open: "warning",
  in_review: "info",
  assigned: "violet",
  resolved: "good",
  low: "neutral",
  medium: "info",
  high: "serious",
  urgent: "critical",
  // risk bands
  risk_low: "good",
  risk_medium: "warning",
  risk_high: "critical",
  // reports
  generating: "warning",
  ready: "good",
  // agents
  offline: "neutral",
};

export function Badge({ value, label: text }: { value: string; label: string }) {
  const tone = STATUS_TONES[value] ?? "neutral";
  return (
    <span
      className={`inline-flex items-center rounded-full border px-2 py-[0.1875rem] text-[0.6875rem] font-medium leading-none ${TONE_CLASSES[tone]}`}
    >
      {text}
    </span>
  );
}

export function EmptyState({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="flex flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line px-6 py-14 text-center">
      <p className="text-[0.875rem] font-medium text-ink-2">{title}</p>
      {hint && <p className="max-w-sm text-[0.75rem] text-ink-3">{hint}</p>}
      {action && <div className="mt-2">{action}</div>}
    </div>
  );
}

export function BackLink({ href, label }: { href: string; label: string }) {
  return (
    <Link
      href={href}
      className="mb-4 inline-flex items-center gap-1 text-[0.75rem] text-ink-3 transition-colors hover:text-ink-2"
    >
      <ArrowLeft size={14} /> {label}
    </Link>
  );
}

/** Definition-list row used on detail pages. */
export function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div className="flex items-baseline justify-between gap-4 py-1.5">
      <dt className="text-[0.75rem] text-ink-3">{label}</dt>
      <dd className="text-right text-[0.8125rem] text-ink">{children}</dd>
    </div>
  );
}
