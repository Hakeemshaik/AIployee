"use client";

import { useMemo, useState } from "react";
import { AlertTriangle, Download, PhoneOff, Search } from "lucide-react";
import { count, money, percent } from "@/lib/format";
import { Badge, Card } from "@/components/ui";
import { Pager } from "@/components/Pager";
import { paginate } from "@/lib/paginate";
import { FunnelStep, Metric } from "@/components/Metric";
import { CumulativeReachChart, ReachByHourChart } from "@/components/charts";
import { AccountDrawer } from "./AccountDrawer";

type Bucket =
  | "conversation"
  | "answered_few_words"
  | "connected_no_conversation"
  | "never_connected"
  | "never_called";

export type AnalyticsPayload = {
  source: "demo" | "live";
  workspace: string;
  campaignName: string;
  formulas: Record<string, string>;
  bucketLabels: Record<Bucket, string>;
  bucketExplanations: Record<Bucket, string>;
  analytics: {
    accounts: number;
    calls: number;
    attempted: number;
    buckets: Record<Bucket, number>;
    reachedAccounts: number;
    conversationAccounts: number;
    deadNumberAccounts: number;
    contactAccounts: number;
    rpcAccounts: number;
    wrongPartyAccounts: number;
    penetration: number;
    contactRate: number;
    rpcRate: number;
    bookRpcRate: number;
    dialsPerRpc: number;
    ptpRate: number;
    dataQualityFailRate: number;
    commitments: {
      floor: number;
      ceiling: number;
      arrearsUnderCommitment: number;
      count: number;
      withoutStatedAmount: number;
    };
    reachByAttempt: { attempt: number; firstReached: number; cumulative: number; cumulativeRate: number }[];
    reachByHour: { hour: number; attempts: number; reached: number; rate: number }[];
  };
  rows: {
    accountId: string;
    name: string;
    phone: string;
    unit: string | null;
    building: string | null;
    balance: number;
    bucket: Bucket;
    attempts: number;
    bestDurationSeconds: number;
    tenantWords: number;
    hasPtp: boolean;
    disputed: boolean;
    paidClaimed: boolean;
    escalated: boolean;
    doNotCall: boolean;
  }[];
  /** Transcript coverage. Reach is read from transcripts, so a call without
   *  one counts as not reached — the screen must be able to say how many. */
  transcripts?: { total: number; withTranscript: number };
};

const BUCKET_ORDER: Bucket[] = [
  "conversation",
  "answered_few_words",
  "connected_no_conversation",
  "never_connected",
  "never_called",
];

type Chip = { key: string; label: string; count: number; title: string };

function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 6)}•••${phone.slice(-3)}` : phone;
}

export function AnalyticsView({ payload, canCall }: { payload: AnalyticsPayload; canCall: boolean }) {
  const { analytics: a, rows } = payload;
  const [filter, setFilter] = useState<string>("all");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [openAccount, setOpenAccount] = useState<string | null>(null);
  // The list used to show the 200 largest balances and quietly drop the rest.
  // Fifty at a time, with every page reachable — a book of two thousand
  // accounts has nowhere to hide.
  const [page, setPage] = useState(1);

  const chips: Chip[] = useMemo(() => {
    const flag = (key: string, label: string, pred: (r: AnalyticsPayload["rows"][number]) => boolean, title: string) => ({
      key, label, count: rows.filter(pred).length, title,
    });
    return [
      { key: "all", label: "All accounts", count: rows.length, title: "Every account in the book" },
      ...BUCKET_ORDER.map((b) => ({
        key: b,
        label: payload.bucketLabels[b],
        count: a.buckets[b],
        title: payload.bucketExplanations[b],
      })),
      flag("has_ptp", "Has PTP", (r) => r.hasPtp, "A promise to pay is recorded"),
      flag("disputed", "Disputed", (r) => r.disputed, "The account holder disputes the debt"),
      flag("paid_claimed", "Paid-claimed", (r) => r.paidClaimed, "The account holder says it is already settled"),
      flag("escalated", "Escalated", (r) => r.escalated, "Handed to a human collector"),
    ];
  }, [rows, a.buckets, payload.bucketLabels, payload.bucketExplanations]);

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "has_ptp") return r.hasPtp;
        if (filter === "disputed") return r.disputed;
        if (filter === "paid_claimed") return r.paidClaimed;
        if (filter === "escalated") return r.escalated;
        return r.bucket === filter;
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.phone.includes(q) || (r.unit ?? "").toLowerCase().includes(q))
      .sort((x, y) => y.balance - x.balance); // default: balance descending
  }, [rows, filter, search]);

  const shown = paginate(visible, page);
  const deadRows = useMemo(() => rows.filter((r) => r.bucket === "never_connected"), [rows]);
  const selectedRows = visible.filter((r) => selected.has(r.accountId));
  const selectedValue = selectedRows.reduce((s, r) => s + r.balance, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function exportDeadNumbers() {
    const header = "name,phone,unit,building,balance,attempts";
    const body = deadRows
      .map((r) => [r.name, r.phone, r.unit ?? "", r.building ?? "", Math.round(r.balance), r.attempts].join(","))
      .join("\n");
    const blob = new Blob([`${header}\n${body}`], { type: "text/csv" });
    const url = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = url;
    link.download = "contact-repair-list.csv";
    link.click();
    URL.revokeObjectURL(url);
  }

  const missingTranscripts = payload.transcripts
    ? payload.transcripts.total - payload.transcripts.withTranscript
    : 0;

  return (
    <div className="space-y-5">
      {/* Reach is a transcript reading. Until every call has one, the reach and
          PTP figures below are a floor, not a result — say so on the screen
          rather than letting an understated number pass as final. */}
      {missingTranscripts > 0 && (
        <div className="rounded-lg border border-warning/30 bg-warning/7 px-3.5 py-2.5">
          <p className="text-[0.78125rem] font-medium text-warning">
            {count(missingTranscripts)} of {count(payload.transcripts!.total)} calls have no transcript yet
          </p>
          <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">
            Reach is verified by reading the transcript, so those calls count as not reached. Every figure
            below is a floor until they are fetched — import again with &ldquo;Numbers only&rdquo; switched off
            to complete them.
          </p>
        </div>
      )}

      {/* KPI strip — every tile states its formula */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Metric label="Accounts" value={count(a.accounts)} formula="accounts in book" />
        <Metric label="Calls" value={count(a.calls)} formula="total call records (not accounts)" />
        <Metric
          label="Right-party"
          value={count(a.rpcAccounts)}
          formula={`accounts where the account holder spoke${
            a.wrongPartyAccounts > 0 ? ` — ${a.wrongPartyAccounts} wrong-party contacts excluded` : ""
          }`}
          sub={a.wrongPartyAccounts > 0 ? `${count(a.wrongPartyAccounts)} wrong party` : undefined}
        />
        <Metric label="RPC rate" value={percent(a.rpcRate)} formula={payload.formulas.rpcRate} tone="good" />
        <Metric label="Promises" value={count(a.commitments.count)} formula="accounts with a confirmed commitment" />
        <Metric label="PTP rate" value={percent(a.ptpRate)} formula={payload.formulas.ptpRate} />
        <Metric
          label="Cash committed"
          value={`${money(a.commitments.floor)}–${money(a.commitments.ceiling)}`}
          formula={`floor: ${payload.formulas.cashCommittedFloor} · ceiling: ${payload.formulas.cashCommittedCeiling}`}
          sub={`${a.commitments.withoutStatedAmount} with no stated amount`}
        />
        <Metric
          label="Dead numbers"
          value={count(a.deadNumberAccounts)}
          formula={payload.formulas.dataQualityFailRate}
          tone={a.deadNumberAccounts > 0 ? "critical" : undefined}
          sub={`${percent(a.dataQualityFailRate, 0)} of dialled`}
        />
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card title="Funnel" subtitle="Book → attempted → connected → conversation → promise">
          <div className="space-y-3.5">
            <FunnelStep label="Book" count={a.accounts} total={a.accounts} />
            <FunnelStep label="Attempted" count={a.attempted} previous={a.accounts} total={a.accounts} dropReason="never called" />
            <FunnelStep
              label="Connected"
              count={a.attempted - a.buckets.never_connected}
              previous={a.attempted}
              total={a.accounts}
              dropReason="dead numbers (zero talk time on every attempt)"
            />
            <FunnelStep
              label="Conversation"
              count={a.conversationAccounts}
              previous={a.attempted - a.buckets.never_connected}
              total={a.accounts}
              dropReason="connected but no real conversation"
            />
            <FunnelStep
              label="Promise"
              count={a.commitments.count}
              previous={a.conversationAccounts}
              total={a.accounts}
              dropReason="spoke but did not commit"
            />
          </div>
          <p className="mt-4 border-t border-line-2 pt-3 text-[0.6875rem] leading-relaxed text-ink-3">
            Arrears under commitment {money(a.commitments.arrearsUnderCommitment)} — this is what committed
            accounts owe, not cash committed. Conflating the two overstates the pipeline.
          </p>
        </Card>

        <Card
          className="xl:col-span-2"
          title="Reach rate by hour"
          subtitle="South African time (UTC+2) — reached calls ÷ attempted calls"
        >
          {a.reachByHour.length === 0 ? (
            <p className="py-10 text-center text-[0.8125rem] text-ink-3">No call data yet.</p>
          ) : (
            <ReachByHourChart data={a.reachByHour} />
          )}
        </Card>
      </div>

      <div className="grid items-start gap-4 xl:grid-cols-3">
        <Card
          className="xl:col-span-2"
          title="Cumulative reach by attempt"
          subtitle="Unique accounts counted at their first reach — never summed per round"
        >
          {a.reachByAttempt.length === 0 ? (
            <p className="py-10 text-center text-[0.8125rem] text-ink-3">No attempts yet.</p>
          ) : (
            <CumulativeReachChart data={a.reachByAttempt} />
          )}
        </Card>
        <Card title="Efficiency">
          <dl className="space-y-2.5">
            <div className="flex items-baseline justify-between gap-3" title={payload.formulas.penetration}>
              <dt className="text-[0.75rem] text-ink-3">Book worked</dt>
              <dd className="num text-[0.875rem] font-medium text-ink">{percent(a.penetration)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3" title={payload.formulas.contactRate}>
              <dt className="text-[0.75rem] text-ink-3">Contact rate</dt>
              <dd className="num text-[0.875rem] font-medium text-ink">{percent(a.contactRate)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3" title={payload.formulas.bookRpcRate}>
              <dt className="text-[0.75rem] text-ink-3">RPC across the book</dt>
              <dd className="num text-[0.875rem] font-medium text-ink">{percent(a.bookRpcRate)}</dd>
            </div>
            <div className="flex items-baseline justify-between gap-3" title={payload.formulas.dialsPerRpc}>
              <dt className="text-[0.75rem] text-ink-3">Dials per RPC</dt>
              <dd className="num text-[0.875rem] font-medium text-ink">
                {a.dialsPerRpc > 0 ? a.dialsPerRpc.toFixed(1) : "—"}
              </dd>
            </div>
            <div className="flex items-baseline justify-between gap-3" title={payload.formulas.dataQualityFailRate}>
              <dt className="text-[0.75rem] text-ink-3">Data-quality fail</dt>
              <dd className="num text-[0.875rem] font-medium text-ink">{percent(a.dataQualityFailRate)}</dd>
            </div>
          </dl>
          <p className="mt-4 text-[0.6875rem] leading-relaxed text-ink-3">
            Reach is decided from transcript content, never from the platform&apos;s voicemail flag —
            that flag misfires badly.
          </p>
        </Card>
      </div>

      {/* Dead numbers — these need new phone numbers, not more attempts */}
      {deadRows.length > 0 && (
        <Card
          title="Dead numbers"
          subtitle={`${deadRows.length} accounts where every attempt had zero talk time`}
          actions={
            <button className="btn" onClick={exportDeadNumbers}>
              <Download size={13} /> Export for contact repair
            </button>
          }
        >
          <p className="mb-3 flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/7 px-3 py-2 text-[0.78125rem] text-warning">
            <AlertTriangle size={14} className="mt-0.5 shrink-0" />
            These accounts need new phone numbers, not more attempts. Re-dialling them will not
            improve recovery — send the export to whoever maintains the contact data.
          </p>
          {/* Its own scroll pane rather than a cut-off list: the export is the
              thing to act on, so the table is here to confirm what is in it and
              every row belongs in it. */}
          <div className="scroll-x max-h-72 overflow-y-auto overscroll-contain">
            <table className="data-table">
              <thead>
                <tr><th>Name</th><th>Unit</th><th>Phone</th><th className="text-right">Balance</th><th className="text-right">Attempts</th></tr>
              </thead>
              <tbody>
                {deadRows.map((r) => (
                  <tr key={r.accountId}>
                    <td>
                      <button
                        onClick={() => setOpenAccount(r.accountId)}
                        className="text-left text-ink hover:text-accent hover:underline"
                        title="Open call history and transcripts"
                      >
                        {r.name}
                      </button>
                    </td>
                    <td className="text-ink-3">{r.unit ?? "—"}</td>
                    <td className="num text-ink-3">{maskPhone(r.phone)}</td>
                    <td className="num text-right">{money(r.balance)}</td>
                    <td className="num text-right">{r.attempts}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </Card>
      )}

      {/* Account table */}
      <Card pad={false}>
        <div className="flex flex-wrap items-center gap-2 p-4 pb-3">
          <div className="relative">
            <Search size={13} className="pointer-events-none absolute left-2.5 top-1/2 -translate-y-1/2 text-ink-3" />
            <input
              value={search}
              onChange={(e) => {
                setSearch(e.target.value);
                setPage(1);
              }}
              placeholder="Name, phone or unit…"
              className="field w-[230px] pl-8"
              aria-label="Search accounts"
            />
          </div>
          <div className="flex flex-wrap gap-1.5">
            {chips.map((chip) => (
              <button
                key={chip.key}
                onClick={() => {
                  setFilter(chip.key);
                  setPage(1);
                }}
                title={chip.title}
                className={`rounded-full border px-2.5 py-1 text-[0.6875rem] transition-colors ${
                  filter === chip.key
                    ? "border-accent/45 bg-accent-soft text-ink"
                    : "border-line bg-ink/[0.03] text-ink-2 hover:text-ink"
                }`}
              >
                {chip.label} <span className="num text-ink-3">{chip.count}</span>
              </button>
            ))}
          </div>
        </div>

        <div className="scroll-x">
          <table className="data-table">
            <thead>
              <tr>
                <th className="w-8"></th>
                <th>Name</th><th>Unit</th><th>Building</th><th>Phone</th>
                <th className="text-right">Balance</th>
                <th>Status</th>
                <th className="text-right">Attempts</th>
                <th className="text-right">Best duration</th>
                <th>Flags</th>
                <th className="text-right">Action</th>
              </tr>
            </thead>
            <tbody>
              {shown.rows.map((r) => (
                <tr key={r.accountId}>
                  <td>
                    <input
                      type="checkbox"
                      checked={selected.has(r.accountId)}
                      onChange={() => toggle(r.accountId)}
                      className="h-3.5 w-3.5 accent-[#16b3a2]"
                      aria-label={`Select ${r.name}`}
                    />
                  </td>
                  <td>
                    <button
                      onClick={() => setOpenAccount(r.accountId)}
                      className="text-left font-medium text-ink hover:text-accent hover:underline"
                      title="Open call history and transcripts"
                    >
                      {r.name}
                    </button>
                  </td>
                  <td className="text-ink-3">{r.unit ?? "—"}</td>
                  <td className="max-w-[150px] truncate text-ink-3">{r.building ?? "—"}</td>
                  <td className="num text-ink-3">{maskPhone(r.phone)}</td>
                  <td className="num text-right font-medium text-ink">{money(r.balance)}</td>
                  <td title={payload.bucketExplanations[r.bucket]}>
                    <Badge
                      value={
                        r.bucket === "conversation" ? "promise_to_pay"
                        : r.bucket === "answered_few_words" ? "callback_requested"
                        : r.bucket === "connected_no_conversation" ? "voicemail"
                        : r.bucket === "never_connected" ? "failed"
                        : "neutral"
                      }
                      label={payload.bucketLabels[r.bucket]}
                    />
                  </td>
                  <td className="num text-right">{r.attempts}</td>
                  <td className="num text-right">{r.bestDurationSeconds > 0 ? `${r.bestDurationSeconds}s` : "—"}</td>
                  <td>
                    <span className="flex flex-wrap gap-1">
                      {r.hasPtp && <Badge value="fulfilled" label="PTP" />}
                      {r.disputed && <Badge value="dispute" label="Dispute" />}
                      {r.paidClaimed && <Badge value="paid_in_full_claimed" label="Payment claimed" />}
                      {r.escalated && <Badge value="escalated" label="Escalated" />}
                      {r.doNotCall && <Badge value="opted_out" label="Do not call" />}
                    </span>
                  </td>
                  <td className="text-right">
                    {r.bucket === "never_connected" ? (
                      <span className="inline-flex items-center gap-1 text-[0.6875rem] text-ink-3" title="This number is dead — it needs repair, not another attempt">
                        <PhoneOff size={11} /> needs new number
                      </span>
                    ) : (
                      <button
                        className="btn text-[0.6875rem]"
                        disabled={!canCall || r.doNotCall || r.disputed || r.escalated || r.hasPtp}
                        title={
                          !canCall
                            ? "Calling is disabled in the demo"
                            : r.doNotCall ? "Do-not-call flag set"
                            : r.disputed ? "Account is disputed"
                            : r.escalated ? "Account is escalated"
                            : r.hasPtp ? "A live promise to pay exists"
                            : "Queue this account for a call"
                        }
                      >
                        Call
                      </button>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className="px-4 pb-3">
          <Pager
            page={shown.page}
            pageCount={shown.pageCount}
            total={shown.total}
            from={shown.from}
            to={shown.to}
            noun="accounts"
            onPage={setPage}
          />
        </div>
      </Card>

      <AccountDrawer
        accountId={openAccount}
        onClose={() => setOpenAccount(null)}
        bucketLabels={payload.bucketLabels}
        bucketExplanations={payload.bucketExplanations}
      />

      {/* sticky bulk action bar */}
      {selectedRows.length > 0 && (
        <div className="fixed bottom-4 left-1/2 z-40 -translate-x-1/2">
          <div className="card-float flex items-center gap-4 px-4 py-3">
            <span className="text-[0.8125rem] text-ink">
              <span className="num font-semibold">{selectedRows.length}</span> selected ·{" "}
              <span className="num">{money(selectedValue)}</span>
            </span>
            <button
              className="btn btn-primary"
              disabled={!canCall}
              title={canCall ? "Queue the selected accounts" : "Calling is disabled in the demo"}
            >
              Call {selectedRows.length} selected
            </button>
            <button className="btn btn-ghost" onClick={() => setSelected(new Set())}>Clear</button>
          </div>
        </div>
      )}
    </div>
  );
}
