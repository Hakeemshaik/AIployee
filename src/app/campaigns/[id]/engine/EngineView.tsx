"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileSpreadsheet,
  FileText,
  Loader2,
  PhoneCall,
  Play,
  ShieldAlert,
  Upload,
} from "lucide-react";
import { count, money, percent } from "@/lib/format";
import { Badge, Card, StatCard } from "@/components/ui";
import { Select } from "@/components/Select";
import { Overlay } from "@/components/Overlay";
import { useConfirm } from "@/components/Dialog";
import type { EngineState } from "@/services/engine/state";

// ---------------------------------------------------------------------------
// The engine, on one screen.
//
// The state machine has five stages and the screen leads with whichever one is
// live: load the book, cut a round, call the batches, read the results, close
// the campaign. Everything a number claims is one click from the accounts —
// and the transcripts — behind it, because a count nobody can trace is a count
// nobody will trust.
//
// While a batch is calling, the page IS the job runner: it ticks the batch
// every two minutes, which drips the next writes, ingests the results and runs
// the guards. Closing the tab pauses progress; nothing is lost, the next tick
// picks up from the cursor.
// ---------------------------------------------------------------------------

type AccountRow = {
  id: string;
  fullName: string;
  phone: string | null;
  unitNumber: string | null;
  buildingName: string | null;
  totalDue: number;
  state: string;
  outcome: string | null;
  attempts: number;
  needsReview: boolean;
  reviewReason: string | null;
  lastReach: string | null;
  lastExcerpt: string | null;
};

type NeedsMapping = {
  needsMapping: true;
  file: string;
  fingerprint: string;
  header: string[];
  preview: string[][];
  columnCount: number;
};

type ImportSummary = {
  accounts: number;
  arrears: number;
  undialable: number;
  multiUnit: { count: number; total: number; largestUnitOnly: number; difference: number };
  skipped: { row: number; reason: string }[];
  rowsCollapsed: number;
};

const REACH_LABEL: Record<string, string> = {
  SPOKE: "Spoke",
  VOICEMAIL: "Voicemail",
  NO_ANSWER: "No answer",
  ZERO_DURATION: "0 seconds",
};

const FIELD_OPTIONS = [
  { key: "tenant", label: "Tenant name" },
  { key: "bal", label: "Balance" },
  { key: "phone", label: "Contact number" },
  { key: "unit", label: "Unit" },
  { key: "building", label: "Building" },
  { key: "code", label: "Tenant code (optional)" },
] as const;

export function EngineView({ initial, campaignId }: { initial: EngineState; campaignId: string }) {
  const confirm = useConfirm();
  const [state, setState] = useState<EngineState>(initial);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "error"; text: string } | null>(null);

  // import stage
  const [files, setFiles] = useState<File[]>([]);
  const [paste, setPaste] = useState("");
  const [mapper, setMapper] = useState<NeedsMapping | null>(null);
  const [mapping, setMapping] = useState<Record<string, string>>({});
  const [summary, setSummary] = useState<ImportSummary | null>(null);

  // drill-through
  const [drill, setDrill] = useState<{ title: string; rows: AccountRow[] } | null>(null);

  const refresh = useCallback(async () => {
    try {
      const response = await fetch(`/api/engine/${campaignId}`, { cache: "no-store" });
      if (response.ok) setState((await response.json()) as EngineState);
    } catch {
      // The next poll refreshes; a blip is not worth a banner.
    }
  }, [campaignId]);

  // --- the in-app poller ------------------------------------------------------
  const liveBatchIds = useMemo(
    () => state.batches.filter((b) => b.status === "calling").map((b) => b.id),
    [state.batches],
  );
  const ticking = useRef(false);
  useEffect(() => {
    if (liveBatchIds.length === 0) return;
    const tick = async () => {
      if (ticking.current) return;
      ticking.current = true;
      try {
        for (const id of liveBatchIds) {
          await fetch(`/api/engine/batch/${id}/tick`, { method: "POST" });
        }
        await refresh();
      } finally {
        ticking.current = false;
      }
    };
    const timer = setInterval(tick, 120_000);
    void tick();
    return () => clearInterval(timer);
  }, [liveBatchIds, refresh]);

  async function act(label: string, run: () => Promise<Response>): Promise<boolean> {
    setBusy(label);
    setNotice(null);
    try {
      const response = await run();
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setNotice({ kind: "error", text: body.message ?? "The server refused." });
        return false;
      }
      await refresh();
      return true;
    } catch {
      setNotice({ kind: "error", text: "The server could not be reached." });
      return false;
    } finally {
      setBusy(null);
    }
  }

  // --- import -----------------------------------------------------------------
  async function runImport(manual?: { fingerprint: string; mapping: Record<string, number | null> }) {
    setBusy("import");
    setNotice(null);
    try {
      const form = new FormData();
      for (const file of files) form.append("files", file);
      if (paste.trim()) form.append("paste", paste);
      if (manual) form.append("manual", JSON.stringify(manual));
      const response = await fetch(`/api/engine/${campaignId}/import`, { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) {
        setNotice({ kind: "error", text: body.message ?? "The import was refused." });
        return;
      }
      if (body.needsMapping) {
        setMapper(body as NeedsMapping);
        setMapping({});
        return;
      }
      setMapper(null);
      setSummary(body.summary as ImportSummary);
      setNotice({ kind: "ok", text: "Book loaded." });
      await refresh();
    } catch {
      setNotice({ kind: "error", text: "The upload failed." });
    } finally {
      setBusy(null);
    }
  }

  function submitMapping() {
    if (!mapper) return;
    const required = ["tenant", "bal", "phone", "unit", "building"];
    if (required.some((key) => mapping[key] === undefined || mapping[key] === "")) {
      setNotice({ kind: "error", text: "Map every field except the tenant code." });
      return;
    }
    void runImport({
      fingerprint: mapper.fingerprint,
      mapping: {
        tenant: Number(mapping.tenant),
        bal: Number(mapping.bal),
        phone: Number(mapping.phone),
        unit: Number(mapping.unit),
        building: Number(mapping.building),
        code: mapping.code === undefined || mapping.code === "" ? null : Number(mapping.code),
      },
    });
  }

  async function openDrill(title: string, query: string) {
    const response = await fetch(`/api/engine/${campaignId}/accounts?${query}`, { cache: "no-store" });
    if (!response.ok) return;
    const body = await response.json();
    setDrill({ title, rows: body.rows as AccountRow[] });
  }

  const status = state.campaign.engineStatus;
  const rounds = useMemo(() => {
    const grouped = new Map<number, EngineState["batches"]>();
    for (const batch of state.batches) {
      const list = grouped.get(batch.round) ?? [];
      list.push(batch);
      grouped.set(batch.round, list);
    }
    return [...grouped.entries()].sort((a, b) => b[0] - a[0]);
  }, [state.batches]);

  const chip = "rounded-full border border-line bg-white/60 px-2.5 py-1 text-[0.6875rem] text-ink-2";

  return (
    <div className="space-y-5">
      {/* --- blocking alerts lead everything ---------------------------------- */}
      {state.alerts.map((alert) => (
        <div key={alert.id} className="rise-in rounded-2xl border border-critical/35 bg-critical/[0.06] px-4 py-3.5">
          <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-critical">
            <ShieldAlert size={15} className="mt-0.5 shrink-0" />
            {alert.message}
          </p>
          <button
            className="btn mt-2.5"
            disabled={busy !== null}
            onClick={() =>
              act("ack", () =>
                fetch(`/api/engine/${campaignId}/alerts/${alert.id}`, { method: "POST" }),
              )
            }
          >
            I have read this — lift the block
          </button>
        </div>
      ))}

      {notice && (
        <p
          className={`rounded-xl border px-3.5 py-2.5 text-[0.8125rem] ${
            notice.kind === "ok"
              ? "border-good/35 bg-good/[0.07] text-ink"
              : "border-critical/35 bg-critical/[0.06] text-critical"
          }`}
        >
          {notice.text}
        </p>
      )}

      {/* --- stage 1 · the book ------------------------------------------------ */}
      {(status === "none" || status === "draft") && (
        <Card
          title="1 · Load the book"
          subtitle="Drop the client's files or paste the rows — layouts are detected, names cleaned, phones fixed, one account per person"
        >
          <div className="grid gap-4 lg:grid-cols-2">
            <div>
              <input
                type="file"
                multiple
                accept=".xlsx,.xls,.csv"
                onChange={(e) => setFiles([...(e.target.files ?? [])])}
                className="hidden"
                id="engine-files"
              />
              <label
                htmlFor="engine-files"
                className="flex h-36 cursor-pointer flex-col items-center justify-center gap-2 rounded-2xl border-2 border-dashed border-line bg-white/40 text-center transition-colors hover:border-accent/45"
              >
                <Upload size={20} className="text-ink-3" />
                <span className="text-[0.8125rem] text-ink-2">
                  {files.length > 0
                    ? files.map((f) => f.name).join(", ")
                    : "Drop 1–4 Excel or CSV files, or click to choose"}
                </span>
              </label>
            </div>
            <textarea
              value={paste}
              onChange={(e) => setPaste(e.target.value)}
              placeholder="…or paste rows straight from Excel (tab-separated)"
              className="field h-36 w-full resize-none rounded-2xl font-mono text-[0.71875rem]"
            />
          </div>
          <button
            className="btn btn-primary mt-4"
            disabled={busy !== null || (files.length === 0 && !paste.trim())}
            onClick={() => void runImport()}
          >
            {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : <FileSpreadsheet size={14} />}
            {busy === "import" ? "Reading the book…" : "Build the book"}
          </button>
        </Card>
      )}

      {/* --- the manual mapper, when detection refuses to guess ---------------- */}
      {mapper && (
        <Overlay>
          <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[6vh]">
            <div className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]" onClick={() => setMapper(null)} />
            <div className="card-float pop-in relative flex max-h-[88dvh] w-full max-w-3xl flex-col overflow-y-auto p-5">
              <h2 className="text-[0.9375rem] font-semibold text-ink">Map this file by hand</h2>
              <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-2">
                <span className="font-medium text-ink">{mapper.file}</span> has {mapper.columnCount} columns
                and no layout matched confidently — guessing is how a building name ends up read out as a
                unit number. Pick the six fields once; this layout is remembered and maps itself next time.
              </p>
              <div className="scroll-x mt-3">
                <table className="data-table">
                  <thead>
                    <tr>{mapper.header.map((h, i) => <th key={i}>{h || `Column ${i + 1}`}</th>)}</tr>
                  </thead>
                  <tbody>
                    {mapper.preview.slice(1).map((row, r) => (
                      <tr key={r}>{row.map((cell, c) => <td key={c} className="max-w-[140px] truncate">{cell}</td>)}</tr>
                    ))}
                  </tbody>
                </table>
              </div>
              <div className="mt-4 grid gap-3 sm:grid-cols-3">
                {FIELD_OPTIONS.map((field) => (
                  <div key={field.key}>
                    <p className="mb-1.5 text-[0.71875rem] font-medium text-ink-2">{field.label}</p>
                    <Select
                      value={mapping[field.key] ?? ""}
                      onChange={(value) => setMapping((m) => ({ ...m, [field.key]: value }))}
                      className="w-full"
                      placeholder="Pick a column"
                      aria-label={field.label}
                      options={[
                        ...(field.key === "code" ? [{ value: "", label: "No tenant code" }] : []),
                        ...mapper.header.map((h, i) => ({ value: String(i), label: h || `Column ${i + 1}` })),
                      ]}
                    />
                  </div>
                ))}
              </div>
              <div className="mt-4 flex justify-end gap-2">
                <button className="btn" onClick={() => setMapper(null)}>Cancel</button>
                <button className="btn btn-primary" disabled={busy !== null} onClick={submitMapping}>
                  {busy === "import" ? <Loader2 size={14} className="animate-spin" /> : null}
                  Use this mapping
                </button>
              </div>
            </div>
          </div>
        </Overlay>
      )}

      {/* --- the book, once loaded --------------------------------------------- */}
      {state.book.accounts > 0 && (
        <>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            <StatCard i={0} label="Accounts" value={count(state.book.accounts)} sub="one per person — duplicates collapsed" />
            <StatCard i={1} label="Book value" value={money(state.book.arrears)} sub="whole rand, summed per person" />
            <StatCard
              i={2}
              label="Round"
              value={state.campaign.currentRound === 0 ? "—" : `${state.campaign.currentRound} of ${state.campaign.maxRounds}`}
              sub={status.replace(/_/g, " ")}
            />
            <StatCard
              i={3}
              label="No contact number"
              value={count(state.book.undialable)}
              tone={state.book.undialable > 0 ? "critical" : undefined}
              sub="kept, never uploaded — needs contact repair"
            />
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <a href={`/api/engine/${campaignId}/import-file`} className="btn">
              <Download size={14} /> Jobix import (.xlsx)
            </a>
            <p className="text-[0.6875rem] text-ink-3">
              The cleaned book as the 72-column import workbook — for a manual upload or the archive.
              The engine itself dials by API and never needs it.
            </p>
          </div>

          {summary && summary.skipped.length > 0 && (
            <Card title="Rows the import skipped" subtitle="Each with its reason — nothing is dropped silently">
              <ul className="grid gap-1 text-[0.75rem] text-ink-2 sm:grid-cols-2">
                {summary.skipped.slice(0, 12).map((skip, i) => (
                  <li key={i}>Row {skip.row}: {skip.reason}</li>
                ))}
              </ul>
              {summary.skipped.length > 12 && (
                <p className="mt-2 text-[0.6875rem] text-ink-3">and {summary.skipped.length - 12} more.</p>
              )}
            </Card>
          )}

          {state.book.multiUnit.count > 0 && (
            <Card
              title="Multi-unit tenants"
              subtitle="Collapsed to one call each — the agent quotes their combined balance, described by their largest unit"
            >
              <p className="text-[0.8125rem] text-ink-2">
                <span className="num font-semibold text-ink">{state.book.multiUnit.count}</span> tenants hold
                more than one unit, owing{" "}
                <span className="num font-semibold text-ink">{money(state.book.multiUnit.total)}</span> in total.
                Without the collapse they would each have been dialled once per unit in the same round.
              </p>
              <button className="btn mt-3" onClick={() => void openDrill("Multi-unit tenants", "state=pending")}>
                Show them
              </button>
            </Card>
          )}
        </>
      )}

      {/* --- stage 2/3 · rounds and batches ------------------------------------ */}
      {["ready", "between_rounds"].includes(status) && state.book.accounts > 0 && (
        <Card
          title={state.campaign.currentRound === 0 ? "2 · Cut round 1" : `Round ${state.campaign.currentRound} is done`}
          subtitle="Largest balances first, batches frozen at creation, codes never reused"
        >
          {/* §5.4: the switch-channel table is shown BEFORE another round is offered. */}
          {state.switchChannel.count > 0 && (
            <div className="mb-4 rounded-xl border border-warning/35 bg-warning/[0.08] px-3.5 py-3">
              <p className="text-[0.8125rem] font-medium text-ink">
                <span className="num">{count(state.switchChannel.count)}</span> accounts holding{" "}
                <span className="num font-semibold">{money(state.switchChannel.arrears)}</span> have
                exhausted automated calling.
              </p>
              <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">
                Attempt five produced zero conversations on real runs. These belong on WhatsApp, SMS or
                written notice — they are in the worklists below, not in the next round.
              </p>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-2">
            {state.campaign.currentRound < state.campaign.maxRounds ? (
              <button
                className="btn btn-primary"
                disabled={busy !== null || !!state.campaign.engineBlock}
                onClick={() => act("round", () => fetch(`/api/engine/${campaignId}/round`, { method: "POST" }))}
              >
                {busy === "round" ? <Loader2 size={14} className="animate-spin" /> : <Play size={14} />}
                {state.campaign.currentRound === 0
                  ? "Cut round 1"
                  : `Build round ${state.campaign.currentRound + 1}`}
              </button>
            ) : (
              <span className="text-[0.8125rem] text-ink-2">
                Round {state.campaign.maxRounds} was the last automated round.
              </span>
            )}
            {status === "between_rounds" && (
              <button
                className="btn"
                disabled={busy !== null}
                onClick={async () => {
                  const ok = await confirm({
                    title: "Complete this campaign?",
                    body: "It freezes forever — no further dialling. The report and the worklists become final.",
                    confirmLabel: "Complete it",
                  });
                  if (ok) void act("complete", () => fetch(`/api/engine/${campaignId}/complete`, { method: "POST" }));
                }}
              >
                <CheckCircle2 size={14} /> Complete campaign
              </button>
            )}
            {!state.window.allowed && (
              <span className="text-[0.71875rem] text-warning">{state.window.reason}</span>
            )}
          </div>
        </Card>
      )}

      {rounds.map(([round, batches]) => {
        const dialled = batches.reduce((sum, b) => sum + b.attempts, 0);
        const total = batches.reduce((sum, b) => sum + b.accountCount, 0);
        return (
          <Card
            key={round}
            title={`Round ${round} batches`}
            subtitle={`${count(dialled)} of ${count(total)} accounts dialled`}
          >
            <div className="space-y-2.5">
              {batches.map((batch) => {
                const previousDone = batches
                  .filter((b) => b.index < batch.index)
                  .every((b) => b.status === "complete");
                return (
                  <div key={batch.id} className="rounded-xl border border-line-2 bg-white/50 px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-3">
                      <span className="num text-[0.8125rem] font-semibold text-ink">{batch.code}</span>
                      <span className={chip}>{count(batch.accountCount)} accounts</span>
                      <span className={chip}>{money(batch.arrears)}</span>
                      <Badge value={batch.status === "calling" ? "active" : batch.status === "paused" ? "paused" : batch.status === "complete" ? "completed" : "draft"} label={batch.status} />
                      <span className="ml-auto flex items-center gap-2">
                        {batch.status === "calling" && (
                          <span className="num text-[0.71875rem] text-ink-2">
                            <span className="pulse-live mr-1.5 inline-block h-1.5 w-1.5 rounded-full bg-accent" />
                            {batch.uploadedCount}/{batch.accountCount} sent · {batch.attempts} results
                          </span>
                        )}
                        {batch.status === "pending" && round === state.campaign.currentRound && (
                          <button
                            className="btn btn-primary btn-sm"
                            disabled={busy !== null || !previousDone || !state.window.allowed || !!state.campaign.engineBlock}
                            title={
                              !previousDone
                                ? "The previous batch must finish first"
                                : !state.window.allowed
                                  ? state.window.reason
                                  : "Write this batch to Jobix and let the flow dial it"
                            }
                            onClick={async () => {
                              const ok = await confirm({
                                title: `Call batch ${batch.code}?`,
                                body: `${batch.accountCount} accounts holding ${money(batch.arrears)} are fed to the platform a few at a time — real phones ring as each row lands. Keep this page open; it paces the batch.`,
                                confirmLabel: `Call ${batch.accountCount} accounts`,
                                kind: "call",
                              });
                              if (ok) void act(batch.id, () => fetch(`/api/engine/batch/${batch.id}/start`, { method: "POST" }));
                            }}
                          >
                            {busy === batch.id ? <Loader2 size={12} className="animate-spin" /> : <PhoneCall size={12} />}
                            Call this batch
                          </button>
                        )}
                      </span>
                    </div>
                    {batch.status === "paused" && batch.pausedReason && (
                      <div className="mt-2.5 rounded-lg border border-warning/35 bg-warning/[0.08] px-3 py-2">
                        <p className="text-[0.75rem] text-ink">{batch.pausedReason}</p>
                        <div className="mt-2 flex gap-2">
                          <button
                            className="btn btn-sm"
                            disabled={busy !== null}
                            onClick={() =>
                              act("rerun", () =>
                                fetch(`/api/engine/batch/${batch.id}/resume`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({ voidAndRerun: true, maxConcurrency: 2 }),
                                }),
                              )
                            }
                          >
                            Re-run at lower concurrency (does not count as an attempt)
                          </button>
                          <button
                            className="btn btn-sm"
                            disabled={busy !== null}
                            onClick={() =>
                              act("resume", () =>
                                fetch(`/api/engine/batch/${batch.id}/resume`, {
                                  method: "POST",
                                  headers: { "Content-Type": "application/json" },
                                  body: JSON.stringify({}),
                                }),
                              )
                            }
                          >
                            Just resume
                          </button>
                        </div>
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          </Card>
        );
      })}

      {/* --- stage 4 · results, every count clickable --------------------------- */}
      {state.rounds.map((round) => (
        <Card
          key={`results-${round.round}`}
          title={`Round ${round.round} results`}
          subtitle="Counted per account. Every number opens the accounts — and the words — behind it."
        >
          <div className="flex flex-wrap gap-2">
            {[
              { label: "Accounts dialled", value: round.dialled, query: `round=${round.round}` },
              { label: "Calls placed", value: round.calls, query: `round=${round.round}` },
              { label: "Answered", value: round.answered, query: "state=reached" },
              { label: "Substantive (≥15 words)", value: round.substantive, query: "state=reached" },
              { label: "Rang, no answer", value: round.rang, query: `round=${round.round}` },
              { label: "Voicemail", value: round.voicemail, query: `round=${round.round}` },
              { label: "0 seconds", value: round.zeroDuration, query: `round=${round.round}` },
            ].map((item) => (
              <button
                key={item.label}
                className="rounded-full border border-line bg-white/60 px-3 py-1.5 text-[0.75rem] text-ink-2 transition-all hover:border-accent/45 hover:bg-white hover:text-ink"
                onClick={() => void openDrill(`Round ${round.round} — ${item.label}`, item.query)}
              >
                {item.label} <span className="num font-semibold text-ink">{count(item.value)}</span>
              </button>
            ))}
            {round.outcomes.map((entry) => (
              <button
                key={entry.outcome}
                className="rounded-full border border-accent/40 bg-accent/[0.08] px-3 py-1.5 text-[0.75rem] text-ink transition-all hover:bg-accent/[0.14]"
                onClick={() => void openDrill(`Outcome — ${entry.outcome}`, `state=resolved`)}
              >
                {entry.outcome} <span className="num font-semibold">{count(entry.count)}</span>
              </button>
            ))}
          </div>
        </Card>
      ))}

      {/* --- stage 5 · worklists and the close ----------------------------------- */}
      {(status === "between_rounds" || status === "complete") && (
        <Card
          title={status === "complete" ? "The campaign is closed" : "Where every account stands"}
          subtitle="Rows and arrears reconcile exactly to the book — the export refuses otherwise"
        >
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr><th>Worklist</th><th className="text-right">Accounts</th><th className="text-right">Arrears</th><th className="text-right"></th></tr>
              </thead>
              <tbody>
                {state.worklistPreview.map((list) => (
                  <tr key={list.key}>
                    <td className="text-ink">{list.title}</td>
                    <td className="num text-right">{count(list.count)}</td>
                    <td className="num text-right">{money(list.arrears)}</td>
                    <td className="text-right">
                      {list.count > 0 && (
                        <button
                          className="btn text-[0.6875rem]"
                          onClick={() => void openDrill(list.title, `list=${list.key}`)}
                        >
                          Open
                        </button>
                      )}
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          {status === "complete" && state.report && (
            <>
              <div className="mt-4 grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
                <StatCard label="Right-party contact rate" value={percent(state.report.rightPartyContactRate)} sub={`${count(state.report.reached)} of ${count(state.report.dialled)} accounts dialled`} />
                <StatCard label="Promises to pay" value={count(state.report.ptpCount)} tone="good" sub={`${percent(state.report.ptpRate)} of accounts reached`} />
                <StatCard label="Arrears under commitment" value={money(state.report.arrearsUnderCommitment)} sub="what the committing tenants owe" />
                <StatCard label="Cash committed" value={money(state.report.cashCommitted)} sub={`what they agreed to pay · ${count(state.report.commitmentsWithoutAmount)} with no stated amount`} />
              </div>
              <div className="mt-4 flex flex-wrap gap-2">
                <a href={`/api/engine/${campaignId}/report`} className="btn btn-primary">
                  <FileText size={14} /> Client report (.docx)
                </a>
                <a href={`/api/engine/${campaignId}/worklists`} className="btn">
                  <Download size={14} /> Worklists (.xlsx)
                </a>
              </div>
            </>
          )}
        </Card>
      )}

      {/* --- the drill-through ---------------------------------------------------- */}
      {drill && (
        <Overlay>
          <div className="fixed inset-0 z-50 flex justify-end">
            <div className="scrim-in absolute inset-0 bg-ink/25 backdrop-blur-[3px]" onClick={() => setDrill(null)} />
            <div className="sheet-in relative flex h-[100dvh] w-full max-w-[min(94vw,760px)] flex-col overflow-hidden border-l border-white/70 bg-plane/92 backdrop-blur-2xl sm:rounded-l-[26px]">
              <div className="flex shrink-0 items-center justify-between gap-3 border-b border-line px-5 py-4">
                <h2 className="text-[0.9375rem] font-semibold text-ink">
                  {drill.title} <span className="num font-normal text-ink-3">{drill.rows.length}</span>
                </h2>
                <button className="btn btn-ghost" onClick={() => setDrill(null)}>Close</button>
              </div>
              <div className="min-h-0 flex-1 space-y-2.5 overflow-y-auto overscroll-contain px-5 py-4">
                {drill.rows.map((row) => (
                  <div key={row.id} className="rounded-xl border border-line-2 bg-white/60 px-3.5 py-3">
                    <div className="flex flex-wrap items-center gap-x-3 gap-y-1">
                      <span className="text-[0.8125rem] font-medium text-ink">{row.fullName}</span>
                      <span className="num text-[0.71875rem] text-ink-3">
                        {row.unitNumber ?? "—"} · {row.buildingName ?? "—"} · {row.phone ?? "no number"}
                      </span>
                      <span className="num ml-auto text-[0.8125rem] font-semibold text-ink">{money(row.totalDue)}</span>
                    </div>
                    <div className="mt-1.5 flex flex-wrap items-center gap-2 text-[0.6875rem] text-ink-3">
                      <span>{row.attempts} attempt{row.attempts === 1 ? "" : "s"}</span>
                      {row.lastReach && <span>· {REACH_LABEL[row.lastReach] ?? row.lastReach}</span>}
                      {row.outcome && <Badge value={row.outcome === "PTP" ? "promise_to_pay" : row.outcome === "DISPUTE" ? "dispute" : "neutral"} label={row.outcome} />}
                      {row.needsReview && (
                        <span className="inline-flex items-center gap-1 text-warning">
                          <AlertTriangle size={11} /> {row.reviewReason}
                        </span>
                      )}
                    </div>
                    {row.lastExcerpt && (
                      <p className="mt-2 rounded-lg bg-ink/[0.04] px-2.5 py-1.5 text-[0.71875rem] leading-relaxed text-ink-2">
                        “{row.lastExcerpt}”
                      </p>
                    )}
                  </div>
                ))}
                {drill.rows.length === 0 && (
                  <p className="py-10 text-center text-[0.8125rem] text-ink-3">Nothing here.</p>
                )}
              </div>
            </div>
          </div>
        </Overlay>
      )}
    </div>
  );
}
