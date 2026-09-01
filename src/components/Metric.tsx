import type { ReactNode } from "react";
import { Info } from "lucide-react";
import { count as formatCount } from "@/lib/format";

/**
 * A KPI tile whose formula is always available. The brief requires every
 * displayed metric to state its exact formula, so the tooltip is not optional.
 */
export function Metric({
  label,
  value,
  formula,
  sub,
  tone,
}: {
  label: string;
  value: string;
  formula: string;
  sub?: ReactNode;
  tone?: "good" | "critical" | "accent";
}) {
  const valueColor =
    tone === "good" ? "text-good" : tone === "critical" ? "text-critical" : "text-ink";
  return (
    <div className="card-2 px-4 py-3.5" title={`Formula: ${formula}`}>
      <p className="flex items-center gap-1 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
        {label}
        <Info size={10} className="opacity-60" aria-hidden />
        <span className="sr-only">Formula: {formula}</span>
      </p>
      <p
        className={`mt-1.5 font-semibold leading-tight tracking-tight ${valueColor} ${
          value.length > 12 ? "text-[1rem]" : "text-[1.375rem]"
        }`}
      >
        {value}
      </p>
      {sub && <p className="mt-1.5 text-[0.71875rem] text-ink-3">{sub}</p>}
    </div>
  );
}

/** Funnel step with drop-off and the reason for the drop. */
export function FunnelStep({
  label,
  count,
  previous,
  dropReason,
  total,
}: {
  label: string;
  count: number;
  previous?: number;
  dropReason?: string;
  total: number;
}) {
  const width = total > 0 ? Math.max(2, (count / total) * 100) : 0;
  const dropped = previous !== undefined ? previous - count : null;
  return (
    <div>
      <div className="mb-1 flex items-baseline justify-between gap-3">
        <span className="text-[0.8125rem] text-ink">{label}</span>
        <span className="num text-[0.8125rem] font-medium text-ink">
          {formatCount(count)}
          {total > 0 && (
            <span className="ml-2 text-[0.6875rem] font-normal text-ink-3">
              {Math.round((count / total) * 100)}%
            </span>
          )}
        </span>
      </div>
      <div className="h-2 overflow-hidden rounded-full bg-ink/[0.05]">
        <div className="h-full rounded-full bg-accent" style={{ width: `${width}%` }} />
      </div>
      {dropped !== null && dropped > 0 && (
        <p className="mt-1 text-[0.6875rem] text-ink-3">
          −{formatCount(dropped)} {dropReason}
        </p>
      )}
    </div>
  );
}
