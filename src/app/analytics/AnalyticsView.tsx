"use client";

import { useMemo, useState } from "react";
import { Download, PhoneForwarded, PhoneOff, Search, UserRound } from "lucide-react";
import { count, money, percent } from "@/lib/format";
import { Badge, Card, StatCard } from "@/components/ui";
import { Pager } from "@/components/Pager";
import { paginate } from "@/lib/paginate";
import { FunnelStep } from "@/components/Metric";
import { CumulativeReachChart, ReachByHourChart } from "@/components/charts";
import { AccountDrawer } from "./AccountDrawer";

// ---------------------------------------------------------------------------
// Call analytics, arranged as the four questions a collections manager
// actually asks, in the order they ask them:
//
//   1. How is it going?            — four headline figures, nothing else
//   2. Where does the book stand?  — the funnel, and where the MONEY sits
//   3. When do calls land?         — by hour and by attempt
//   4. What do we do next?         — three actions, each with a button
//
// and then the accounts themselves, for when a question is about one person.
//
// The screen used to open with eight metric tiles of mixed importance, a
// separate Efficiency card restating some of them, and a full second table for
// dead numbers. Every number on it was defensible; together they read as a
// spreadsheet. What was cut is not gone — the formulas still live in tooltips,
// dead numbers are an action row with the same export, and anything about one
// account is one click into the drawer.
// ---------------------------------------------------------------------------

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

/**
 * One colour per bucket for the money bars, all validated on white.
 *
 * The encoding is reachability: teal is money in live conversations, thinning
 * as the contact gets weaker; amber is money behind numbers that never
 * connect, which no amount of redialling will reach; grey is money not yet
 * worked. Amber is the only alarm on the chart, because it is the only bucket
 * where the fix is not "call again".
 */
const BUCKET_BAR: Record<Bucket, string> = {
  conversation: "#0E9E90",
  answered_few_words: "rgba(14, 158, 144, 0.6)",
  connected_no_conversation: "rgba(14, 158, 144, 0.32)",
  never_connected: "#C97A0F",
  never_called: "rgba(21, 32, 46, 0.22)",
};

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

  // The composite filters from "What to do next" get a chip only while active,
  // so the table always says what it is showing without ten permanent chips
  // becoming twelve.
  const activeComposite =
    filter === "ring_again"
      ? { key: "ring_again", label: "Ring again", count: 0, title: "Answered before, no conversation yet, safe to dial" }
      : filter === "needs_person"
        ? { key: "needs_person", label: "Needs a person", count: 0, title: "Disputed or escalated" }
        : null;

  const visible = useMemo(() => {
    const q = search.trim().toLowerCase();
    return rows
      .filter((r) => {
        if (filter === "all") return true;
        if (filter === "has_ptp") return r.hasPtp;
        if (filter === "disputed") return r.disputed;
        if (filter === "paid_claimed") return r.paidClaimed;
        if (filter === "escalated") return r.escalated;
        // The two composite filters exist so the "What to do next" buttons
        // show exactly the accounts their row counted — a button that says 12
        // and a table that shows 9 is a bug wearing a filter.
        if (filter === "ring_again")
          return (
            (r.bucket === "answered_few_words" || r.bucket === "connected_no_conversation") &&
            !r.doNotCall && !r.hasPtp && !r.disputed && !r.escalated
          );
        if (filter === "needs_person") return r.disputed || r.escalated;
        return r.bucket === filter;
      })
      .filter((r) => !q || r.name.toLowerCase().includes(q) || r.phone.includes(q) || (r.unit ?? "").toLowerCase().includes(q))
      .sort((x, y) => y.balance - x.balance); // default: balance descending
  }, [rows, filter, search]);

  const shown = paginate(visible, page);
  const selectedRows = visible.filter((r) => selected.has(r.accountId));
  const selectedValue = selectedRows.reduce((s, r) => s + r.balance, 0);

  // --- where the money sits ---------------------------------------------
  // The buckets as counts say how many people are reachable; as rand they say
  // whether the RECOVERABLE money is reachable, which is the question the
  // counts only gesture at. A book can be 80% contactable and still have most
  // of its value behind dead numbers.
  const moneyByBucket = useMemo(() => {
    const sums = Object.fromEntries(BUCKET_ORDER.map((b) => [b, 0])) as Record<Bucket, number>;
    for (const r of rows) sums[r.bucket] += r.balance;
    const total = rows.reduce((s, r) => s + r.balance, 0);
    return { sums, total };
  }, [rows]);

  // --- the three next actions --------------------------------------------
  const ringAgain = useMemo(
    () => rows.filter((r) => (r.bucket === "answered_few_words" || r.bucket === "connected_no_conversation") && !r.doNotCall && !r.hasPtp && !r.disputed && !r.escalated),
    [rows],
  );
  const deadRows = useMemo(() => rows.filter((r) => r.bucket === "never_connected"), [rows]);
  const needsPerson = useMemo(() => rows.filter((r) => r.disputed || r.escalated), [rows]);
  const sum = (list: typeof rows) => list.reduce((s, r) => s + r.balance, 0);

  function toggle(id: string) {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  /** An action row's button: filter the table to those accounts and go there. */
  function showAccounts(key: string) {
    setFilter(key);
    setSearch("");
    setPage(1);
    document.getElementById("accounts")?.scrollIntoView({ behavior: "smooth", block: "start" });
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

  // Cash committed is a range only when the floor and ceiling differ; a range
  // whose ends are equal is one number said twice.
  const cash =
    a.commitments.floor === a.commitments.ceiling
      ? money(a.commitments.floor)
      : `${money(a.commitments.floor)}–${money(a.commitments.ceiling)}`;

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

      {/* --- 1 · how is it going -------------------------------------------- */}
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <StatCard
          i={0}
          label="Contact rate"
          value={percent(a.contactRate)}
          meter={a.contactRate}
          sub={`${count(a.contactAccounts)} of ${count(a.attempted)} attempted accounts answered`}
        />
        <StatCard
          i={1}
          label="Promises to pay"
          value={count(a.commitments.count)}
          tone={a.commitments.count > 0 ? "good" : undefined}
          sub={`${percent(a.ptpRate)} of right-party conversations commit`}
        />
        <StatCard
          i={2}
          label="Cash committed"
          value={cash}
          sub={
            a.commitments.withoutStatedAmount > 0
              ? `${count(a.commitments.withoutStatedAmount)} promise${a.commitments.withoutStatedAmount === 1 ? "" : "s"} with no stated amount`
              : `across ${count(a.commitments.count)} commitment${a.commitments.count === 1 ? "" : "s"}`
          }
        />
        <StatCard
          i={3}
          label="Book worked"
          value={percent(a.penetration)}
          meter={a.penetration}
          sub={`${count(a.attempted)} of ${count(a.accounts)} accounts dialled${a.dialsPerRpc > 0 ? ` · ${a.dialsPerRpc.toFixed(1)} dials per right-party talk` : ""}`}
        />
      </div>

      {/* --- 2 · where the book stands --------------------------------------- */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card title="The funnel" subtitle="How many people, at each step from book to promise">
          <div className="space-y-3.5">
            <FunnelStep label="Book" count={a.accounts} total={a.accounts} />
            <FunnelStep label="Attempted" count={a.attempted} previous={a.accounts} total={a.accounts} dropReason="never called" />
            <FunnelStep
              label="Connected"
              count={a.contactAccounts}
              previous={a.attempted}
              total={a.accounts}
              dropReason="numbers that never answered"
            />
            <FunnelStep
              label="Conversation"
              count={a.conversationAccounts}
              previous={a.contactAccounts}
              total={a.accounts}
              dropReason="hung up or said nothing"
            />
            <FunnelStep
              label="Promise"
              count={a.commitments.count}
              previous={a.conversationAccounts}
              total={a.accounts}
              dropReason="talked but did not commit"
            />
          </div>
        </Card>

        <Card
          title="Where the money sits"
          subtitle="Arrears by how reachable the account holder is"
        >
          <div className="space-y-3.5">
            {BUCKET_ORDER.map((bucket, index) => {
              const value = moneyByBucket.sums[bucket];
              const share = moneyByBucket.total > 0 ? value / moneyByBucket.total : 0;
              return (
                <div key={bucket} title={payload.bucketExplanations[bucket]}>
                  <div className="mb-1 flex items-baseline justify-between gap-3">
                    <span className="text-[0.8125rem] text-ink">{payload.bucketLabels[bucket]}</span>
                    <span className="num text-[0.8125rem] font-medium text-ink">
                      {money(value)}
                      <span className="ml-2 text-[0.6875rem] font-normal text-ink-3">
                        {Math.round(share * 100)}%
                      </span>
                    </span>
                  </div>
                  <div className="h-2 overflow-hidden rounded-full bg-ink/[0.05]">
                    <div
                      className="h-full rounded-full transition-[width] duration-700"
                      style={{
                        width: `${Math.max(share > 0 ? 2 : 0, share * 100)}%`,
                        background: BUCKET_BAR[bucket],
                        transitionDelay: `${index * 60}ms`,
                      }}
                    />
                  </div>
                </div>
              );
            })}
          </div>
          {moneyByBucket.sums.never_connected > 0 && (
            <p className="mt-4 text-[0.71875rem] leading-relaxed text-ink-3">
              <span className="font-medium text-warning">
                {money(moneyByBucket.sums.never_connected)}
              </span>{" "}
              sits behind numbers that never connect — redialling cannot reach it, new numbers can.
            </p>
          )}
        </Card>
      </div>

      {/* --- 3 · when calls land --------------------------------------------- */}
      <div className="grid items-start gap-4 xl:grid-cols-2">
        <Card
          title="Reach by time of day"
          subtitle="South African time — reached calls ÷ attempted calls, per hour"
        >
          {a.reachByHour.length === 0 ? (
            <p className="py-10 text-center text-[0.8125rem] text-ink-3">No call data yet.</p>
          ) : (
            <ReachByHourChart data={a.reachByHour} />
          )}
        </Card>
        <Card
          title="Reach by attempt"
          subtitle="Unique accounts counted at their first reach — when does another round stop paying?"
        >
          {a.reachByAttempt.length === 0 ? (
            <p className="py-10 text-center text-[0.8125rem] text-ink-3">No attempts yet.</p>
          ) : (
            <CumulativeReachChart data={a.reachByAttempt} />
          )}
        </Card>
      </div>

      {/* --- 4 · what to do next ---------------------------------------------
          Three rows, each a decision already made: who to ring again, whose
          numbers to replace, who needs a person. The counts are the same
          accounts the table below shows — the button just takes you there. */}
      <Card title="What to do next" subtitle="The book, sorted into the three moves available">
        <div className="divide-y divide-line-2">
          <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-accent/12">
              <PhoneForwarded size={16} className="text-accent" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium text-ink">Ring again</p>
              <p className="text-[0.71875rem] leading-relaxed text-ink-2">
                Answered before but no real conversation yet — another attempt has a fair chance.
              </p>
            </div>
            <span className="num text-right text-[0.8125rem] text-ink">
              {count(ringAgain.length)} <span className="text-ink-3">· {money(sum(ringAgain))}</span>
            </span>
            <button className="btn" onClick={() => showAccounts("ring_again")} disabled={ringAgain.length === 0}>
              Show them
            </button>
          </div>

          <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-warning/12">
              <PhoneOff size={16} className="text-warning" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium text-ink">Get new numbers</p>
              <p className="text-[0.71875rem] leading-relaxed text-ink-2">
                Every attempt had zero talk time — these need contact repair, not more dialling.
              </p>
            </div>
            <span className="num text-right text-[0.8125rem] text-ink">
              {count(deadRows.length)} <span className="text-ink-3">· {money(sum(deadRows))}</span>
            </span>
            <span className="flex gap-2">
              <button className="btn" onClick={() => showAccounts("never_connected")} disabled={deadRows.length === 0}>
                Show them
              </button>
              <button className="btn" onClick={exportDeadNumbers} disabled={deadRows.length === 0} title="CSV for whoever maintains the contact data">
                <Download size={13} /> Export
              </button>
            </span>
          </div>

          <div className="flex flex-wrap items-center gap-3 py-3 first:pt-0 last:pb-0">
            <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-xl bg-critical/10">
              <UserRound size={16} className="text-critical" />
            </span>
            <div className="min-w-0 flex-1">
              <p className="text-[0.8125rem] font-medium text-ink">Hand to a person</p>
              <p className="text-[0.71875rem] leading-relaxed text-ink-2">
                Disputed or escalated — the AI is done here, and dialling them again causes harm.
              </p>
            </div>
            <span className="num text-right text-[0.8125rem] text-ink">
              {count(needsPerson.length)} <span className="text-ink-3">· {money(sum(needsPerson))}</span>
            </span>
            <button className="btn" onClick={() => showAccounts("needs_person")} disabled={needsPerson.length === 0}>
              Show them
            </button>
          </div>
        </div>
      </Card>

      {/* --- the accounts ------------------------------------------------------ */}
      <Card pad={false} className="scroll-mt-24" id="accounts">
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
            {[...(activeComposite ? [activeComposite] : []), ...chips].map((chip) => (
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
                {chip.label}{" "}
                <span className="num text-ink-3">
                  {chip.key === filter && activeComposite ? visible.length : chip.count}
                </span>
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
