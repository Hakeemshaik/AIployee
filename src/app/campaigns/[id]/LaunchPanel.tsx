"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  Check,
  ClipboardCopy,
  Loader2,
  PhoneOutgoing,
  Search,
  CalendarClock,
  RefreshCw,
  Send,
  ShieldCheck,
  Users,
  X,
} from "lucide-react";
import { count, money, formatDateTime } from "@/lib/format";
import { GlassCard } from "@/components/ui";

// ---------------------------------------------------------------------------
// Campaign launch, as one flow.
//
// Step 1 reviews who will be dialled — eligible count and value, and every
// excluded account with its reason. Step 2 generates the paste table with the
// batch code already in the `call` column; pasting it into the Jobix database
// screen is the one manual step, replacing both the old import and the
// stamping step. Step 3 either triggers the flow now or sets a time to trigger
// it — Jobix dials exactly the rows carrying the batch code either way.
//
// While a scheduled start is pending this panel asks the server whether it is
// due, every fifteen seconds. That is what makes "start in five minutes" work
// on a host whose own scheduler only runs once a day; the unattended path is
// /api/cron/campaigns.
// ---------------------------------------------------------------------------

type LaunchState = {
  campaignName: string;
  status: string;
  batchCode: string | null;
  startedAt: string | null;
  eligible: number;
  totalValue: number;
  excluded: { reason: string; count: number }[];
  window: { allowed: boolean; reason: string; sastTime: string };
  callingEnabled: boolean;
  /** "insert" means writing a customer is what dials them. */
  flowStart: "insert" | "trigger";
  triggerConfigured: boolean;
  scheduledFor: string | null;
  scheduleError: string | null;
};

type PreparedList = { csv: string; rowCount: number; batchCode: string; callFlag: string | null };

/** What the voice platform says is actually armed to dial right now. */
type ArmedCheck = {
  flag: string | null;
  armed: number;
  armedForThisBatch: number;
  armedForOtherBatch: number;
  scanned: number;
  complete: boolean;
  verdict: string;
};

async function fetchState(campaignId: string): Promise<LaunchState> {
  const response = await fetch(`/api/campaigns/${campaignId}/launch`, { cache: "no-store" });
  const body = (await response.json()) as LaunchState & { message?: string };
  if (!response.ok) throw new Error(body.message ?? "The launch status could not be loaded.");
  return body;
}

type RowProbe = {
  account: string;
  build: string;
  variants: { variant: string; suid: string; sent: unknown; received: unknown; landed: boolean }[];
  scanned: number;
  scanComplete: boolean;
  verdict: string;
};

type SendResult = {
  batchCode: string;
  written: number;
  armed: number;
  attempted: number;
  confirmed: number;
  created: number;
  updated: number;
  relinked: number;
  duplicated: number;
  unsent: number;
  scanned: number;
  referenceless: boolean;
  scanComplete: boolean;
  flagIsFixed: boolean;
  dialledOnWrite: boolean;
  callFlag: string | null;
  complete: boolean;
  nextStep: string;
  build: string;
  failures: { suid: string; name: string; reason: string }[];
};

export function LaunchPanel({ campaignId, canLaunch }: { campaignId: string; canLaunch: boolean }) {
  const [state, setState] = useState<LaunchState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [refresh, setRefresh] = useState(0);
  const [list, setList] = useState<PreparedList | null>(null);
  const [pasted, setPasted] = useState(false);
  const [sent, setSent] = useState<SendResult | null>(null);
  const [resumable, setResumable] = useState(false);
  const [rowProbe, setRowProbe] = useState<RowProbe | null>(null);

  async function diagnose() {
    setBusy("diagnose");
    setActionError(null);
    setRowProbe(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "probe_row" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The check could not be run.");
      setRowProbe(body as RowProbe);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The check could not be run.");
    } finally {
      setBusy(null);
    }
  }
  const [copied, setCopied] = useState(false);
  const [busy, setBusy] = useState<
    "list" | "send" | "diagnose" | "start" | "schedule" | "cancel" | "armed" | null
  >(null);
  const [armed, setArmed] = useState<ArmedCheck | null>(null);
  const [when, setWhen] = useState("");
  const [now, setNow] = useState(() => Date.now());
  const [actionError, setActionError] = useState<string | null>(null);
  const [started, setStarted] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    fetchState(campaignId)
      .then((loaded) => {
        if (!cancelled) {
          setState(loaded);
          setLoadError(null);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setLoadError(err instanceof Error ? err.message : "The launch status could not be loaded.");
      });
    return () => {
      cancelled = true;
    };
  }, [campaignId, refresh]);

  async function prepareList() {
    setBusy("list");
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "prepare_list" }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The dialling list could not be generated.");
      setList(body as PreparedList);
      setPasted(false);
      setSent(null);
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The dialling list could not be generated.");
    } finally {
      setBusy(null);
    }
  }

  async function sendList() {
    if (!list) return;
    // Whether this is a staging step or the start of the run depends on how the
    // flow begins, and the question has to say which.
    const dialsNow = state?.flowStart === "insert";
    if (
      !window.confirm(
        dialsNow
          ? `Call ${list.rowCount} account${list.rowCount === 1 ? "" : "s"} now?\n\n` +
              "This flow starts when a customer is written, so each account is written with the call flag set and the phone rings as it lands. There is no separate start."
          : `Write ${list.rowCount} customer${list.rowCount === 1 ? "" : "s"} into Jobix and arm them to dial?\n\n` +
              "Each is created or updated with every field. Nothing is called until you start the run.",
      )
    ) {
      return;
    }
    setBusy("send");
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "send_list", confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The list could not be sent.");
      const result = body as SendResult;
      setSent(result);
      // The send is the paste, so the manual confirmation is satisfied by it —
      // but only when everything actually landed and is armed.
      setPasted(result.complete);
      // A partial send has more to do, so the list stays and the button says
      // Continue rather than looking finished.
      if (result.unsent > 0) setResumable(true);
      else setResumable(false);
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The list could not be sent.");
    } finally {
      setBusy(null);
    }
  }

  async function copyList() {
    if (!list) return;
    try {
      await navigator.clipboard.writeText(list.csv);
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    } catch {
      // The textarea below remains selectable for manual copying.
    }
  }

  async function checkArmed() {
    setBusy("armed");
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "check_armed" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.message ?? "The check could not be run.");
      setArmed(body as ArmedCheck);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The check could not be run.");
    } finally {
      setBusy(null);
    }
  }

  async function act(
    body: Record<string, unknown>,
    label: "schedule" | "cancel",
    failure: string,
  ) {
    setBusy(label);
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const parsed = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(parsed.message ?? failure);
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : failure);
    } finally {
      setBusy(null);
    }
  }

  async function start() {
    setBusy("start");
    setActionError(null);
    try {
      const response = await fetch(`/api/campaigns/${campaignId}/launch`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "start", confirmed: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The calls could not be started.");
      setStarted(body.message as string);
      setRefresh((n) => n + 1);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The calls could not be started.");
    } finally {
      setBusy(null);
    }
  }

  // Tick while a schedule is pending: once for the countdown, and a nudge to
  // the server so a due campaign actually starts.
  const scheduledAt = state?.scheduledFor ? new Date(state.scheduledFor).getTime() : null;
  useEffect(() => {
    if (!scheduledAt) return;
    const timer = setInterval(() => {
      setNow(Date.now());
      if (Date.now() >= scheduledAt) {
        fetch("/api/campaigns/due", { method: "POST" })
          .then(() => setRefresh((n) => n + 1))
          .catch(() => {
            /* the next tick tries again */
          });
      }
    }, 15_000);
    return () => clearInterval(timer);
  }, [scheduledAt]);

  if (!canLaunch) return null;

  const secondsAway = scheduledAt ? Math.round((scheduledAt - now) / 1000) : null;
  const countdown =
    secondsAway === null
      ? null
      : secondsAway <= 0
        ? "due now — starting on the next check"
        : secondsAway < 60
          ? `in ${secondsAway} seconds`
          : secondsAway < 3600
            ? `in ${Math.round(secondsAway / 60)} minutes`
            : `in ${(secondsAway / 3600).toFixed(1)} hours`;

  return (
    <GlassCard
      title="Launch on Jobix"
      subtitle="Review the contacts, send the list, start the calls"
      actions={
        <button className="btn btn-ghost" onClick={() => setRefresh((n) => n + 1)} title="Refresh launch status">
          <RefreshCw size={13} />
        </button>
      }
    >
      {loadError && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2 text-[0.78125rem] text-[#e2714a]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {loadError}
        </p>
      )}

      {!state && !loadError && (
        <p className="flex items-center gap-2 py-4 text-[0.8125rem] text-ink-3">
          <Loader2 size={14} className="animate-spin" /> Loading launch status
        </p>
      )}

      {state && (
        <div className="space-y-4">
          {state.scheduledFor && (
            <div className="flex flex-wrap items-center gap-3 rounded-lg border border-[rgba(57,135,229,0.45)] bg-accent-soft px-3 py-2.5">
              <CalendarClock size={14} className="shrink-0 text-accent" />
              <div className="min-w-0 flex-1">
                <p className="text-[0.78125rem] font-medium text-ink">
                  Scheduled to start {formatDateTime(state.scheduledFor)}
                  {countdown ? ` — ${countdown}` : ""}
                </p>
                <p className="mt-0.5 text-[0.6875rem] text-ink-2">
                  Dialling the batch {state.batchCode ?? "—"}. Every guardrail is checked again at the moment
                  it fires.
                </p>
              </div>
              <button
                className="btn"
                disabled={busy !== null}
                onClick={() =>
                  void act({ action: "cancel_schedule" }, "cancel", "The schedule could not be cancelled.")
                }
              >
                {busy === "cancel" ? <Loader2 size={13} className="animate-spin" /> : <X size={13} />}
                Cancel
              </button>
            </div>
          )}

          {state.scheduleError && !state.scheduledFor && (
            <div className="rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2.5">
              <p className="flex items-start gap-2 text-[0.78125rem] font-medium text-[#e2714a]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                The last scheduled start did not go ahead
              </p>
              <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">
                {state.scheduleError}
              </p>
            </div>
          )}

          {/* Step 1 — review */}
          <div>
            <p className="mb-2 flex items-center gap-2 text-[0.78125rem] font-semibold text-ink">
              <Users size={13} className="text-accent" /> 1. Contacts, categorised
            </p>
            <div className="flex flex-wrap items-center gap-1.5">
              <span className="rounded-full border border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.1)] px-2.5 py-1 text-[0.6875rem] text-[#3ecf9a]">
                Will be dialled <span className="num">{count(state.eligible)}</span>
              </span>
              {state.excluded.map((entry) => (
                <span
                  key={entry.reason}
                  className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2"
                  title="Excluded from dialling"
                >
                  {entry.reason} <span className="num text-ink-3">{entry.count}</span>
                </span>
              ))}
            </div>
            <p className="mt-1.5 text-[0.6875rem] text-ink-3">
              Campaign book value {money(state.totalValue)}. Add contacts at Debtors → Import with this
              campaign selected.
            </p>
          </div>

          {/* Step 2 — send the list */}
          <div className="border-t border-line-2 pt-3">
            <p className="mb-2 flex items-center gap-2 text-[0.78125rem] font-semibold text-ink">
              <Send size={13} className="text-accent" /> 2. Send the list to Jobix
            </p>
            {!list ? (
              <div className="flex flex-wrap items-center gap-3">
                <button className="btn" onClick={prepareList} disabled={busy !== null || state.eligible === 0}>
                  {busy === "list" ? <Loader2 size={13} className="animate-spin" /> : <Send size={13} />}
                  Generate dialling list
                </button>
                {state.batchCode && (
                  <span className="num text-[0.6875rem] text-ink-3">
                    Last generated batch: {state.batchCode}
                  </span>
                )}
              </div>
            ) : (
              <div className="space-y-2">
                <p className="text-[0.75rem] leading-relaxed text-ink-2">
                  <span className="num font-medium text-ink">{count(list.rowCount)}</span> rows. Batch{" "}
                  <span className="num text-ink">{list.batchCode}</span> is in the{" "}
                  <span className="num">batch</span> column, which is how results come back to this campaign.
                  {list.callFlag && (
                    <>
                      {" "}
                      The <span className="num">call</span> column carries{" "}
                      <span className="num text-ink">{list.callFlag}</span> — that is what the flow&apos;s
                      entry filter must look for.
                      {list.callFlag === list.batchCode
                        ? " Because it is this run's code, the filter has to name it, which means editing the flow before every run. Set JOBIX_CALL_FLAG to a fixed word and the filter can be written once and left alone."
                        : " It is the same every run, so the flow is configured once and never edited again."}
                    </>
                  )}
                </p>
                <div className="flex flex-wrap items-center gap-2">
                  <button className="btn btn-primary" onClick={sendList} disabled={busy !== null}>
                    {busy === "send" ? (
                      <Loader2 size={13} className="animate-spin" />
                    ) : (
                      <Send size={13} />
                    )}
                    {resumable
                      ? `Continue sending (${count(sent?.unsent ?? 0)} left)`
                      : state.flowStart === "insert"
                        ? `Send and call (${count(list.rowCount)})`
                        : `Send to Jobix (${count(list.rowCount)})`}
                  </button>
                  <span className="text-[0.71875rem] text-ink-3">
                    {state.flowStart === "insert"
                      ? "Writes each customer with every field and the call flag set — this flow dials as each one lands."
                      : "Creates or updates each customer with every field, then arms them to dial."}
                  </span>
                </div>

                {sent && !sent.complete && (
                  <div className="flex flex-wrap items-center gap-2">
                    <button className="btn" disabled={busy !== null} onClick={diagnose}>
                      {busy === "diagnose" ? (
                        <Loader2 size={13} className="animate-spin" />
                      ) : (
                        <Search size={13} />
                      )}
                      Find what Jobix rejected
                    </button>
                    <span className="text-[0.6875rem] leading-relaxed text-ink-3">
                      Writes one account several ways, without the dialling flag, to find which
                      field is being refused. Nobody is called.
                    </span>
                  </div>
                )}

                {rowProbe && (
                  <div className="rounded-lg border border-line bg-white/[0.02] px-3 py-2.5">
                    <p className="text-[0.78125rem] leading-relaxed text-ink">{rowProbe.verdict}</p>
                    <p className="mt-1 text-[0.6875rem] text-ink-3">
                      Tested with {rowProbe.account}, against {count(rowProbe.scanned)} customer
                      records. Answered by {rowProbe.build}.
                    </p>
                    <ul className="mt-2 space-y-1">
                      {rowProbe.variants.map((variant) => (
                        <li key={variant.suid} className="text-[0.71875rem]">
                          <span className={variant.landed ? "text-[#3ecf9a]" : "text-[#e2714a]"}>
                            {variant.landed ? "landed" : "rejected"}
                          </span>{" "}
                          <span className="text-ink-2">{variant.variant}</span>
                        </li>
                      ))}
                    </ul>
                    <details className="mt-2 text-[0.6875rem] text-ink-3">
                      <summary className="cursor-pointer">What was sent, and what came back</summary>
                      <pre className="scroll-x mt-1.5 rounded-lg border border-line bg-black/30 p-2.5 text-[0.625rem] leading-relaxed text-ink-2">
{JSON.stringify(rowProbe.variants, null, 2)}
                      </pre>
                    </details>
                  </div>
                )}

                {sent && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 text-[0.78125rem] ${
                      sent.complete
                        ? "border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.08)] text-ink"
                        : "border-[rgba(242,193,78,0.35)] bg-[rgba(242,193,78,0.08)] text-ink"
                    }`}
                  >
                    <p className="flex items-start gap-2">
                      {sent.complete ? (
                        <Check size={14} className="mt-0.5 shrink-0 text-[#3ecf9a]" />
                      ) : (
                        <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#f2c14e]" />
                      )}
                      {sent.nextStep}
                    </p>
                    <p className="mt-1 pl-[1.4rem] text-[0.6875rem] text-ink-3">
                      Sent by {sent.build}.
                    </p>
                    {sent.failures.length > 0 && (
                      <ul className="mt-2 space-y-1 pl-[1.4rem] text-[0.71875rem] text-ink-2">
                        {sent.failures.map((failure) => (
                          <li key={failure.suid}>
                            <span className="num text-ink-3">{failure.suid}</span> {failure.name} —{" "}
                            {failure.reason}
                          </li>
                        ))}
                      </ul>
                    )}
                  </div>
                )}

                {/* The paste route stays available. If a write is refused —
                    a workspace permission, a field the workspace validates
                    differently — pasting the same table still works, and
                    losing an hour to a blocked button would not. */}
                <details className="text-[0.71875rem] text-ink-3">
                  <summary className="cursor-pointer">Paste it by hand instead</summary>
                  <div className="mt-2 space-y-2">
                    <div className="flex items-center gap-2">
                      <button className="btn" onClick={copyList}>
                        {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                        {copied ? "Copied" : "Copy table"}
                      </button>
                      <span>Jobix dashboard: Database, paste box, import.</span>
                    </div>
                    <textarea
                      readOnly
                      value={list.csv}
                      rows={4}
                      className="field num w-full text-[0.65625rem] leading-relaxed"
                      onFocus={(event) => event.currentTarget.select()}
                    />
                    <label className="flex items-start gap-2 text-[0.75rem] text-ink-2">
                      <input
                        type="checkbox"
                        checked={pasted}
                        onChange={(event) => setPasted(event.target.checked)}
                        className="mt-0.5 h-3.5 w-3.5 accent-[#3987e5]"
                      />
                      I have pasted this list into Jobix and the import completed.
                    </label>
                  </div>
                </details>
              </div>
            )}
          </div>

          {/* Step 3 — start */}
          <div className="border-t border-line-2 pt-3">
            <p className="mb-2 flex items-center gap-2 text-[0.78125rem] font-semibold text-ink">
              <PhoneOutgoing size={13} className="text-accent" /> 3. Start the calls
            </p>
            {started ? (
              <p className="flex items-start gap-2 rounded-lg border border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.08)] px-3 py-2.5 text-[0.78125rem] text-ink">
                <Check size={14} className="mt-0.5 shrink-0 text-[#3ecf9a]" />
                {started}
              </p>
            ) : (
              <div className="space-y-2">
                <div className="flex flex-wrap gap-x-5 gap-y-1 text-[0.71875rem] text-ink-3">
                  <span>
                    Calling window:{" "}
                    <span className={state.window.allowed ? "text-[#3ecf9a]" : "text-[#e2714a]"}>
                      {state.window.allowed ? `open (${state.window.sastTime})` : state.window.reason}
                    </span>
                  </span>
                  <span>
                    Calling enabled:{" "}
                    <span className={state.callingEnabled ? "text-[#3ecf9a]" : "text-[#e2714a]"}>
                      {state.callingEnabled ? "yes" : "no"}
                    </span>
                  </span>
                  <span>
                    Trigger configured:{" "}
                    <span className={state.triggerConfigured ? "text-[#3ecf9a]" : "text-[#e2714a]"}>
                      {state.triggerConfigured ? "yes" : "no"}
                    </span>
                  </span>
                </div>
                <div className="flex flex-wrap items-center gap-2">
                <button
                  className="btn"
                  disabled={busy !== null}
                  title="Ask the voice platform how many records are armed to dial right now"
                  onClick={checkArmed}
                >
                  {busy === "armed" ? <Loader2 size={13} className="animate-spin" /> : <ShieldCheck size={13} />}
                  Check who is armed
                </button>
                <button
                  className="btn btn-primary"
                  disabled={
                    busy !== null ||
                    !pasted ||
                    !state.callingEnabled ||
                    !state.triggerConfigured ||
                    !state.window.allowed
                  }
                  title={
                    !list
                      ? "Generate and paste the dialling list first"
                      : !pasted
                        ? "Send the list to Jobix first, or confirm you pasted it by hand"
                        : !state.callingEnabled
                          ? "Calling is disabled on this deployment"
                          : !state.triggerConfigured
                            ? "The flow trigger is not configured"
                            : !state.window.allowed
                              ? state.window.reason
                              : "Trigger the flow now"
                  }
                  onClick={start}
                >
                  {busy === "start" ? <Loader2 size={13} className="animate-spin" /> : <PhoneOutgoing size={13} />}
                  Start calling now {list ? `(${count(list.rowCount)})` : ""}
                </button>
                </div>

                {armed && (
                  <div
                    className={`rounded-lg border px-3 py-2.5 ${
                      armed.armedForOtherBatch > 0 || !armed.complete
                        ? "border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)]"
                        : "border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.08)]"
                    }`}
                  >
                    <p className="text-[0.78125rem] font-medium text-ink">
                      <span className="num">{count(armed.armed)}</span> records armed to dial
                      {armed.flag ? (
                        <>
                          {" "}
                          (<span className="num">call = {armed.flag}</span>)
                        </>
                      ) : null}
                      {" · "}
                      <span className="num">{count(armed.armedForThisBatch)}</span> from this run
                    </p>
                    <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">{armed.verdict}</p>
                  </div>
                )}

                {/* Or set a time. The presets exist because "in five minutes"
                    is how a test run is actually described. */}
                <div className="rounded-lg border border-line bg-white/[0.02] p-3">
                  <p className="mb-2 flex items-center gap-2 text-[0.75rem] font-medium text-ink">
                    <CalendarClock size={13} className="text-accent" /> Or schedule it
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    {[
                      { label: "In 5 minutes", minutes: 5 },
                      { label: "In 15 minutes", minutes: 15 },
                      { label: "In 1 hour", minutes: 60 },
                      { label: "Tomorrow 09:00", minutes: null },
                    ].map((option) => (
                      <button
                        key={option.label}
                        className="btn"
                        disabled={busy !== null || !pasted}
                        title={
                          !pasted
                            ? "Send the list to Jobix first, or confirm you pasted it by hand"
                            : `Start this campaign ${option.label.toLowerCase()}`
                        }
                        onClick={() => {
                          if (option.minutes) {
                            void act(
                              { action: "schedule", confirmed: true, minutes: option.minutes },
                              "schedule",
                              "The run could not be scheduled.",
                            );
                            return;
                          }
                          // Tomorrow at 09:00 South African time.
                          const sastNow = new Date(Date.now() + 2 * 3_600_000);
                          const at = new Date(
                            Date.UTC(
                              sastNow.getUTCFullYear(),
                              sastNow.getUTCMonth(),
                              sastNow.getUTCDate() + 1,
                              9,
                            ) -
                              2 * 3_600_000,
                          );
                          void act(
                            { action: "schedule", confirmed: true, at: at.toISOString() },
                            "schedule",
                            "The run could not be scheduled.",
                          );
                        }}
                      >
                        {option.label}
                      </button>
                    ))}
                    <input
                      type="datetime-local"
                      className="field w-auto"
                      value={when}
                      onChange={(event) => setWhen(event.target.value)}
                      aria-label="Start at a specific time"
                    />
                    <button
                      className="btn"
                      disabled={busy !== null || !pasted || !when}
                      onClick={() =>
                        void act(
                          { action: "schedule", confirmed: true, at: new Date(when).toISOString() },
                          "schedule",
                          "The run could not be scheduled.",
                        )
                      }
                    >
                      {busy === "schedule" ? <Loader2 size={13} className="animate-spin" /> : null}
                      Schedule
                    </button>
                  </div>
                  <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-3">
                    A scheduled run dials the batch code on the list above, under the same rules as starting
                    now: inside calling hours, calling enabled, trigger configured. Keep this page open and it
                    fires on the minute; unattended firing needs CRON_SECRET set and the scheduler running.
                  </p>
                </div>
              </div>
            )}
          </div>

          {actionError && (
            <p className="flex items-start gap-2 rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2 text-[0.78125rem] text-[#e2714a]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              {actionError}
            </p>
          )}
        </div>
      )}
    </GlassCard>
  );
}
