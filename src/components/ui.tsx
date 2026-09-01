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
 * A wash a card can wear.
 *
 * Colour is how a person finds the card they want before reading a word of it.
 * A plot never gets one: the series colours are validated against white and
 * lose contrast over a tint.
 */
export type Tint = "mint" | "cream" | "lilac" | "peach" | "sky";

const TINTS: Record<Tint, string> = {
  mint: "tint-mint",
  cream: "tint-cream",
  lilac: "tint-lilac",
  peach: "tint-peach",
  sky: "tint-sky",
};

/**
 * A card.
 *
 * `i` staggers its entrance when several arrive together — the row reads
 * left to right instead of appearing all at once. `tint` washes it.
 */
export function Card({
  title,
  subtitle,
  actions,
  children,
  className = "",
  pad = true,
  i,
  tint,
}: {
  title?: string;
  subtitle?: string;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
  pad?: boolean;
  i?: number;
  tint?: Tint;
}) {
  return (
    <section
      className={`card ${tint ? TINTS[tint] : ""} ${i === undefined ? "" : "rise-in"} ${
        pad ? "p-5 sm:p-[1.375rem]" : ""
      } ${className}`}
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
  tint,
  spark,
  meter,
  icon,
}: {
  label: string;
  value: string;
  sub?: string;
  tone?: "good" | "critical" | "accent";
  hero?: boolean;
  i?: number;
  /** A wash, so a tile is recognised by colour before it is read. */
  tint?: Tint;
  /** Thirty-odd values behind the number: the shape of how it got there. */
  spark?: number[];
  /** 0–1. A number that is a share of something reads better as a bar. */
  meter?: number;
  icon?: ReactNode;
}) {
  const valueColor =
    tone === "good"
      ? "text-good"
      : tone === "critical"
        ? "text-critical"
        : tone === "accent"
          ? "text-accent-ink"
          : "text-ink";
  // Three bands, always in this order and always present: the label, the
  // figure, and everything under it. A tile with a sparkline and one without
  // used to be two different shapes, so a row of them had its labels on one
  // line, its figures on another, and its footnotes wherever they landed. The
  // middle band grows and the footnote is pinned to the bottom, so across a
  // row every label, every figure and every footnote sits on one line.
  //
  // The horizontal padding matches a Card's, so a tile's label starts on the
  // same vertical line as the title of the card beneath it. They were 16px and
  // 22px — close enough to read as a mistake rather than a choice.
  return (
    <div
      className={`card flex flex-col ${tint ? TINTS[tint] : ""} ${
        i === undefined ? "" : "rise-in"
      } ${hero ? "p-5 sm:p-[1.375rem]" : "px-5 py-4 sm:px-[1.375rem]"}`}
      style={i === undefined ? undefined : ({ "--i": i } as CSSProperties)}
    >
      <p className="flex items-center gap-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.09em] text-ink-3">
        {icon}
        {label}
      </p>
      <p
        className={`value-in mt-2.5 font-semibold leading-none tracking-tight ${valueColor} ${
          hero ? "num text-[2rem]" : "num text-[1.4375rem]"
        }`}
      >
        {value}
      </p>
      <div className="flex-1">
        {meter !== undefined && (
          <span className="mt-3 block h-1.5 w-full overflow-hidden rounded-full bg-ink/[0.08]">
            <span
              className="block h-full rounded-full bg-accent transition-[width] duration-700"
              style={{ width: `${Math.round(Math.min(1, Math.max(0, meter)) * 100)}%` }}
            />
          </span>
        )}
        {spark && spark.length > 1 && <Sparkline values={spark} className="mt-3" />}
      </div>
      {sub && <p className="mt-2.5 text-[0.71875rem] leading-relaxed text-ink-3">{sub}</p>}
    </div>
  );
}

/**
 * The shape of a series, at tile size.
 *
 * No axes, no grid, no labels: a figure with a line under it says "rising" or
 * "flat" in the time it takes to read the figure, which is the only question a
 * tile can answer. The chart with the numbers on it is elsewhere on the page.
 */
export function Sparkline({
  values,
  className = "",
  height = 26,
}: {
  values: number[];
  className?: string;
  height?: number;
}) {
  const width = 100;
  const min = Math.min(...values);
  const max = Math.max(...values);
  const span = max - min || 1;
  const step = width / (values.length - 1);
  const points = values.map((value, index) => {
    const x = index * step;
    const y = height - ((value - min) / span) * (height - 3) - 1.5;
    return `${x.toFixed(2)},${y.toFixed(2)}`;
  });
  const id = `spark-${values.length}-${Math.round(min)}-${Math.round(max)}`;
  return (
    <svg
      viewBox={`0 0 ${width} ${height}`}
      preserveAspectRatio="none"
      style={{ height }}
      className={`block w-full ${className}`}
      aria-hidden
    >
      <defs>
        <linearGradient id={id} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="var(--color-accent)" stopOpacity="0.22" />
          <stop offset="100%" stopColor="var(--color-accent)" stopOpacity="0" />
        </linearGradient>
      </defs>
      <polygon
        points={`0,${height} ${points.join(" ")} ${width},${height}`}
        fill={`url(#${id})`}
      />
      <polyline
        points={points.join(" ")}
        fill="none"
        stroke="var(--color-accent)"
        strokeWidth="1.75"
        strokeLinecap="round"
        strokeLinejoin="round"
        vectorEffect="non-scaling-stroke"
      />
    </svg>
  );
}

/**
 * One share, drawn as an arc.
 *
 * For a single percentage a ring beats a bar chart of one bar: the figure sits
 * in the middle of its own context, and the gap left in the arc is the part
 * still to win.
 */
export function Gauge({
  value,
  label,
  caption,
}: {
  /** 0–1. */
  value: number;
  label: string;
  caption?: string;
}) {
  const clamped = Math.min(1, Math.max(0, value));
  const radius = 52;
  const circumference = Math.PI * radius; // a half turn
  return (
    <div className="flex flex-col items-center">
      <svg viewBox="0 0 130 78" className="w-full max-w-[220px]" role="img" aria-label={`${label}: ${Math.round(clamped * 100)}%`}>
        <path
          d="M13 65 A52 52 0 0 1 117 65"
          fill="none"
          stroke="var(--color-line)"
          strokeWidth="11"
          strokeLinecap="round"
        />
        <path
          d="M13 65 A52 52 0 0 1 117 65"
          fill="none"
          stroke="var(--color-accent)"
          strokeWidth="11"
          strokeLinecap="round"
          strokeDasharray={`${(circumference * clamped).toFixed(2)} ${circumference.toFixed(2)}`}
        />
        <text
          x="65"
          y="60"
          textAnchor="middle"
          className="num fill-ink text-[1.5rem] font-semibold"
          style={{ fontSize: 22 }}
        >
          {Math.round(clamped * 100)}%
        </text>
      </svg>
      <p className="mt-1 text-center text-[0.78125rem] font-medium text-ink">{label}</p>
      {caption && <p className="mt-0.5 text-center text-[0.71875rem] text-ink-3">{caption}</p>}
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
      <summary className="flex cursor-pointer list-none items-center justify-between gap-3 rounded-[18px] px-5 py-4 transition-colors hover:bg-ink/[0.03]">
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
      <div className="page-in border-t border-ink/[0.07] p-5 sm:p-[1.375rem]">{children}</div>
    </details>
  );
}

// --- status badge -----------------------------------------------------------

type Tone = "neutral" | "info" | "good" | "warning" | "serious" | "critical" | "violet";

// Every badge carries its word as well as its colour, so none of them depends
// on the colour being told apart.
const TONE_CLASSES: Record<Tone, string> = {
  neutral: "border-ink/10 bg-ink/[0.05] text-ink-2",
  info: "border-accent/35 bg-accent/12 text-accent-ink",
  good: "border-good/35 bg-good/12 text-good",
  warning: "border-warning/30 bg-warning/10 text-warning",
  serious: "border-serious/35 bg-serious/12 text-serious",
  critical: "border-critical/35 bg-critical/12 text-critical",
  violet: "border-[#9085e9]/35 bg-[#9085e9]/12 text-[#aaa2ef]",
};

const STATUS_TONES: Record<string, Tone> = {
  // debtor / general
  active: "neutral",
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
  completed: "neutral",
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
  resolved: "neutral",
  low: "neutral",
  medium: "info",
  high: "serious",
  urgent: "critical",
  // risk bands
  risk_low: "neutral",
  risk_medium: "warning",
  risk_high: "critical",
  // reports
  generating: "warning",
  ready: "neutral",
  // agents
  offline: "neutral",
};

/**
 * A state, as a word.
 *
 * The ordinary states are grey text with no pill at all, and this is the whole
 * point of the component. A calls table gave every row three bordered chips —
 * outcome, sentiment, status — so "Completed · Neutral · No answer", which is
 * the most boring row possible, arrived carrying as much colour as a dispute.
 * Colour that appears on every row is not information.
 *
 * So: a pill, in colour, means something happened. Everything routine — active,
 * completed, neutral, no answer, low risk — is a word. On a screen of fifty
 * rows the four that need a person are the four with colour on them.
 */
export function Badge({ value, label: text }: { value: string; label: string }) {
  const tone = STATUS_TONES[value] ?? "neutral";
  if (tone === "neutral") {
    return (
      <span className="inline-flex items-center py-[0.1875rem] text-[0.6875rem] font-medium leading-none text-ink-3">
        {text}
      </span>
    );
  }
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
      <svg width="52" height="34" viewBox="0 0 52 34" fill="none" aria-hidden>
        <rect x="2" y="24" width="4" height="6" rx="2" fill="#0E9E90" opacity="0.35" />
        <rect x="14" y="24" width="4" height="6" rx="2" fill="#0E9E90" opacity="0.26" />
        <rect x="26" y="24" width="4" height="6" rx="2" fill="#0E9E90" opacity="0.18" />
        <rect x="38" y="24" width="4" height="6" rx="2" fill="#C97A0F" opacity="0.22" />
        <path d="M0 33h52" stroke="#15202E" strokeOpacity="0.12" strokeWidth="1" />
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
