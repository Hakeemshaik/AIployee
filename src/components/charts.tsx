"use client";

import {
  Area,
  AreaChart,
  Bar,
  BarChart,
  CartesianGrid,
  Cell,
  Line,
  LineChart,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { count, moneyCompact } from "@/lib/format";

// ---------------------------------------------------------------------------
// Chart primitives — validated dark-mode series palette, one axis per chart,
// thin marks, hairline grid, hover tooltips, and a legend whenever a chart
// carries more than one series.
// ---------------------------------------------------------------------------

// The three series are the Mafadi hues stepped for a WHITE chart surface and
// validated on it as a set — lightness band, chroma floor, colour-vision
// separation on every pair (worst dE 13.5), contrast — not the interface accent
// reused as data.
//
// Charts belong on white cards. Over one of the pastel washes these same three
// fall to 2.9:1, which the method allows only when labels carry the identity
// instead, so a plot never sits on a tinted card.
const C = {
  s1: "#0e9e90", // teal
  s2: "#c97a0f", // gold
  s3: "#6c5ce0", // violet
  grid: "#e9ebf2",
  axis: "#c8cddb",
  muted: "#7b869a",
  ink: "#15202e",
  notReached: "#cfd6e4",
};

const axisProps = {
  stroke: C.axis,
  tick: { fill: C.muted, fontSize: 11 },
  tickLine: false,
  axisLine: { stroke: C.axis },
} as const;

function shortDate(iso: string) {
  const d = new Date(iso);
  return `${d.getDate()}/${d.getMonth() + 1}`;
}

type TooltipRow = { name?: string; value?: number | string; color?: string };
function GlassTooltip({
  active,
  payload,
  label,
  money = false,
}: {
  active?: boolean;
  payload?: TooltipRow[];
  label?: string;
  money?: boolean;
}) {
  if (!active || !payload?.length) return null;
  return (
    <div className="card-float px-3 py-2 text-[0.71875rem]">
      <p className="mb-1 text-ink-3">{label}</p>
      {payload.map((row, i) => (
        <p key={i} className="flex items-center gap-1.5 text-ink">
          <span className="h-2 w-2 rounded-full" style={{ background: row.color }} />
          <span className="text-ink-2">{row.name}:</span>{" "}
          <span className="num font-medium">
            {money && typeof row.value === "number"
              ? `R${count(Math.round(row.value))}`
              : row.value}
          </span>
        </p>
      ))}
    </div>
  );
}

export function ChartLegend({ items }: { items: { label: string; color: string }[] }) {
  return (
    <div className="mb-2 flex flex-wrap gap-x-4 gap-y-1">
      {items.map((item) => (
        <span key={item.label} className="flex items-center gap-1.5 text-[0.6875rem] text-ink-2">
          <span className="h-2 w-2 rounded-full" style={{ background: item.color }} />
          {item.label}
        </span>
      ))}
    </div>
  );
}

/** Cumulative recovery over time — single-series area. */
export function RecoveryTrendChart({
  data,
}: {
  data: { date: string; cumulative: number; received: number }[];
}) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <AreaChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }}>
        <defs>
          <linearGradient id="recFill" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor={C.s1} stopOpacity={0.28} />
            <stop offset="100%" stopColor={C.s1} stopOpacity={0.02} />
          </linearGradient>
        </defs>
        <CartesianGrid stroke={C.grid} strokeDasharray="0" vertical={false} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...axisProps} tickFormatter={(v: number) => moneyCompact(v)} width={52} />
        <Tooltip content={<GlassTooltip money />} cursor={{ stroke: C.axis }} />
        <Area
          type="monotone"
          dataKey="cumulative"
          name="Recovered to date"
          stroke={C.s1}
          strokeWidth={2}
          fill="url(#recFill)"
          dot={false}
          activeDot={{ r: 4, strokeWidth: 0 }}
        />
      </AreaChart>
    </ResponsiveContainer>
  );
}

/** Daily contact activity — connected stacked under not-reached. */
export function ContactActivityChart({
  data,
}: {
  data: { date: string; attempts: number; connected: number }[];
}) {
  const rows = data.map((d) => ({
    ...d,
    notReached: Math.max(0, d.attempts - d.connected),
  }));
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Connected", color: C.s1 },
          { label: "Not reached", color: C.notReached },
        ]}
      />
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="30%">
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={28} />
          <YAxis {...axisProps} allowDecimals={false} width={34} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "rgba(21,32,46,0.05)" }} />
          <Bar dataKey="connected" name="Connected" stackId="a" fill={C.s1} />
          <Bar dataKey="notReached" name="Not reached" stackId="a" fill={C.notReached} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Weekly promise-to-pay conversion — created vs fulfilled. */
export function PromiseConversionChart({
  data,
}: {
  data: { week: string; created: number; fulfilled: number }[];
}) {
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Promises created", color: C.s1 },
          { label: "Fulfilled", color: C.s2 },
        ]}
      />
      <ResponsiveContainer width="100%" height={224}>
        <LineChart data={data} margin={{ top: 6, right: 12, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="week" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} width={34} />
          <Tooltip content={<GlassTooltip />} cursor={{ stroke: C.axis }} />
          <Line type="monotone" dataKey="created" name="Promises created" stroke={C.s1} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: C.s1 }} />
          <Line type="monotone" dataKey="fulfilled" name="Fulfilled" stroke={C.s2} strokeWidth={2} dot={{ r: 3, strokeWidth: 0, fill: C.s2 }} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Daily payments received — single-series bars (rand). */
export function PaymentsBarChart({ data }: { data: { date: string; received: number }[] }) {
  return (
    <ResponsiveContainer width="100%" height={250}>
      <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="30%">
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={28} />
        <YAxis {...axisProps} tickFormatter={(v: number) => moneyCompact(v)} width={52} />
        <Tooltip content={<GlassTooltip money />} cursor={{ fill: "rgba(21,32,46,0.05)" }} />
        <Bar dataKey="received" name="Received" fill={C.s1} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Horizontal magnitude comparison (campaign recovered, outcome counts…). */
export function HBarChart({
  data,
  money = false,
  height,
}: {
  data: { label: string; value: number }[];
  money?: boolean;
  height?: number;
}) {
  return (
    <ResponsiveContainer width="100%" height={height ?? Math.max(140, data.length * 42)}>
      <BarChart data={data} layout="vertical" margin={{ top: 0, right: 12, left: 8, bottom: 0 }} barCategoryGap="32%">
        <CartesianGrid stroke={C.grid} horizontal={false} />
        <XAxis
          type="number"
          {...axisProps}
          tickFormatter={(v: number) => (money ? moneyCompact(v) : String(v))}
          allowDecimals={false}
        />
        <YAxis type="category" dataKey="label" {...axisProps} width={148} tick={{ fill: C.muted, fontSize: 11 }} />
        <Tooltip content={<GlassTooltip money={money} />} cursor={{ fill: "rgba(21,32,46,0.05)" }} />
        <Bar dataKey="value" name={money ? "Recovered" : "Calls"} fill={C.s1} radius={[0, 4, 4, 0]}>
          {data.map((_, i) => (
            <Cell key={i} fill={C.s1} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Book by account age — outstanding vs recovered per aging bucket. */
export function AgingChart({
  data,
}: {
  data: { bucket: string; outstanding: number; recovered: number }[];
}) {
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Outstanding", color: C.s1 },
          { label: "Recovered", color: C.s2 },
        ]}
      />
      <ResponsiveContainer width="100%" height={224}>
        <BarChart data={data} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="28%" barGap={2}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="bucket" {...axisProps} />
          <YAxis {...axisProps} tickFormatter={(v: number) => moneyCompact(v)} width={52} />
          <Tooltip content={<GlassTooltip money />} cursor={{ fill: "rgba(21,32,46,0.05)" }} />
          <Bar dataKey="outstanding" name="Outstanding" fill={C.s1} radius={[4, 4, 0, 0]} />
          <Bar dataKey="recovered" name="Recovered" fill={C.s2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Reach rate by hour of day (SAST) — the most actionable chart on the page. */
export function ReachByHourChart({
  data,
}: {
  data: { hour: number; attempts: number; reached: number; rate: number }[];
}) {
  const rows = data.map((d) => ({
    label: `${String(d.hour).padStart(2, "0")}:00`,
    rate: Math.round(d.rate * 1000) / 10,
    attempts: d.attempts,
  }));
  return (
    <ResponsiveContainer width="100%" height={230}>
      <BarChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="26%">
        <CartesianGrid stroke={C.grid} vertical={false} />
        <XAxis dataKey="label" {...axisProps} />
        <YAxis {...axisProps} width={40} tickFormatter={(v: number) => `${v}%`} />
        <Tooltip
          content={<GlassTooltip />}
          cursor={{ fill: "rgba(21,32,46,0.05)" }}
        />
        <Bar dataKey="rate" name="Reach rate %" fill={C.s1} radius={[4, 4, 0, 0]} />
      </BarChart>
    </ResponsiveContainer>
  );
}

/** Cumulative unique accounts reached, by attempt number. */
export function CumulativeReachChart({
  data,
}: {
  data: { attempt: number; firstReached: number; cumulative: number }[];
}) {
  const rows = data.map((d) => ({ label: `#${d.attempt}`, cumulative: d.cumulative, firstReached: d.firstReached }));
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Cumulative unique accounts reached", color: C.s1 },
          { label: "First reached on this attempt", color: C.s2 },
        ]}
      />
      <ResponsiveContainer width="100%" height={210}>
        <BarChart data={rows} margin={{ top: 6, right: 6, left: 0, bottom: 0 }} barCategoryGap="26%" barGap={2}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="label" {...axisProps} />
          <YAxis {...axisProps} allowDecimals={false} width={36} />
          <Tooltip content={<GlassTooltip />} cursor={{ fill: "rgba(21,32,46,0.05)" }} />
          <Bar dataKey="cumulative" name="Cumulative reached" fill={C.s1} radius={[4, 4, 0, 0]} />
          <Bar dataKey="firstReached" name="First reached here" fill={C.s2} radius={[4, 4, 0, 0]} />
        </BarChart>
      </ResponsiveContainer>
    </div>
  );
}

/** Campaign detail — daily attempts / connected / promises. */
export function CampaignActivityChart({
  data,
}: {
  data: { date: string; attempts: number; connected: number; promises: number }[];
}) {
  return (
    <div>
      <ChartLegend
        items={[
          { label: "Attempts", color: C.s1 },
          { label: "Connected", color: C.s2 },
          { label: "Promises", color: C.s3 },
        ]}
      />
      <ResponsiveContainer width="100%" height={250}>
        <LineChart data={data} margin={{ top: 6, right: 8, left: 0, bottom: 0 }}>
          <CartesianGrid stroke={C.grid} vertical={false} />
          <XAxis dataKey="date" {...axisProps} tickFormatter={shortDate} minTickGap={28} />
          <YAxis {...axisProps} allowDecimals={false} width={34} />
          <Tooltip content={<GlassTooltip />} cursor={{ stroke: C.axis }} />
          <Line type="monotone" dataKey="attempts" name="Attempts" stroke={C.s1} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="connected" name="Connected" stroke={C.s2} strokeWidth={2} dot={false} />
          <Line type="monotone" dataKey="promises" name="Promises" stroke={C.s3} strokeWidth={2} dot={false} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
