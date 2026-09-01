import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import type { CSSProperties, ReactNode } from "react";

// ---------------------------------------------------------------------------
// Shared UI primitives — server-safe, no client JS.
//
// Everything on a screen is one of five things: a page header, a card, a
// number, a state word, or an empty state. Keeping that list short is what
// makes a screen readable; every new shape is one more thing to learn.
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
        <h1 className="text-[1.375rem] font-semibold tracking-tight text-ink">{title}</h1>
        {description && (
          <p className="mt-1.5 max-w-2xl text-[0.8125rem] leading-relaxed text-ink-2">{description}</p>
        )}
      </div>
      {actions && <div className="flex items-center gap-2">{actions}</div>}
    </div>
  );
}

/**
 * A card.
 *
 * `i` staggers its entrance when several arrive together — the row reads
 * left to right instead of appearing all at once.
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  pad = true,
  i,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  i?: number;
}) {
  return (
    <section
      className={`card ${i === undefined ? "" : "rise-in"} ${pad ? "p-5" : ""} ${className}`}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
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

/**
 * A number with its name.
 *
 * `hero` is for the two or three figures a page is actually about: bigger, and
 * in cream, which nothing else on a screen is allowed to use.
 */
export function StatCard({
  label,
  value,
  sub,
  tone,
  hero = false,
  i,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "critical" | "accent";
  hero?: boolean;
  i?: number;
}) {
  const valueColor = hero
    ? "text-cream"
    : tone === "good"
      ? "text-good"
      : tone === "critical"
        ? "text-critical"
        : tone === "accent"
          ? "text-accent-ink"
          : "text-ink";
  return (
    <div
      className={`card-2 ${i === undefined ? "" : "rise-in"} ${hero ? "px-5 py-4" : "px-4 py-3.5"}`}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
      <p className="text-[0.6875rem] font-medium uppercase tracking-[0.08em] text-ink-3">{label}</p>
      <p
        className={`mt-2 font-semibold leading-none tracking-tight ${valueColor} ${
          hero ? "num text-[1.75rem]" : "num text-[1.3125rem]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-2 text-[0.71875rem] leading-relaxed text-ink-3">{sub}</p>}
    </div>
  );
}

/**
 * A band of secondary detail that starts closed.
 *
 * The screens carried everything at once — ten figures and six charts above
 * the fold, none of them ranked. What a page is for stays open; the rest is
 * one click away and stays out of the way until it is asked for.
 */
export function Disclosure({
  summary,
  hint,
  children,
  className = "",
}: {
  summary: string;
  hint?: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <details className={`card group ${className}`}>
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 px-5 py-3.5">
        <span>
          <span className="text-[0.875rem] font-medium text-ink">{summary}</span>
          {hint && <span className="ml-2 text-[0.75rem] text-ink-3">{hint}</span>}
        </span>
        <svg
          width="14"
          height="14"
          viewBox="0 0 14 14"
          fill="none"
          aria-hidden
          className="shrink-0 text-ink-3 transition-transform duration-200 group-open:rotate-180"
        >
          <path d="M3 5.5L7 9.5L11 5.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
        </svg>
      </summary>
      <div className="page-in border-t border-line-2 p-5">{children}</div>
    </details>
  );
}

// --- status badge -----------------------------------------------------------

type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical" | "violet";

// Every badge carries its word as well as its colour, so none of them depends
// on the colour being told apart.
const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-white/10 bg-white/[0.05] text-ink-2",
  info: "border-accent/35 bg-accent/12 text-accent-ink",
  good: "border-good/35 bg-good/12 text-good",
  warning: "border-warning/30 bg-warning/10 text-warning",
  serious: "border-serious/35 bg-serious/12 text-serious",
  critical: "border-critical/35 bg-critical/12 text-critical",
  violet: "border-[#9085e9]/35 bg-[#9085e9]/12 text-[#aaa2ef]",
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
    <div className="card flex flex-col items-center justify-center gap-3 px-6 py-14 text-center">
      {/* The mark's own bars, flattened: nothing has been measured yet. */}
      <svg width="52" height="34" viewBox="0 0 52 34" fill="none" aria-hidden className="opacity-70">
        <rect x="2" y="24" width="4" height="6" rx="2" fill="#16B3A2" opacity="0.28" />
        <rect x="14" y="24" width="4" height="6" rx="2" fill="#16B3A2" opacity="0.22" />
        <rect x="26" y="24" width="4" height="6" rx="2" fill="#16B3A2" opacity="0.16" />
        <rect x="38" y="24" width="4" height="6" rx="2" fill="#FBF3D6" opacity="0.16" />
        <path d="M0 33h52" stroke="currentColor" strokeOpacity="0.12" strokeWidth="1" />
      </svg>
      <p className="text-[0.875rem] font-medium text-ink-2">{title}</p>
      {hint && <p className="max-w-sm text-[0.75rem] leading-relaxed text-ink-3">{hint}</p>}
      {action && <div className="mt-1">{action}</div>}
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
