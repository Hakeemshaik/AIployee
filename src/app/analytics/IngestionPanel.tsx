"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  ServerCog,
} from "lucide-react";
import { count, formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Ingestion control.
//
// A run is resumable by design — cached transcripts are never re-fetched — so
// the honest thing to show is phase, counters and the fact that pressing Run
// again continues rather than restarts.
//
// A book of a few thousand calls cannot be pulled inside one serverless
// request. The server stops itself at its budget and reports "interrupted";
// this panel then continues automatically, slice after slice, so the operator
// sees one advancing progress bar instead of having to press Run eleven times.
//
// Two failures are configuration, not bugs, and are reported as such: Jobix not
// configured on the server (501) and a workspace mismatch (409), which blocks
// the run precisely because the same endpoints return plausible data from the
// wrong workspace.
// ---------------------------------------------------------------------------

export type Progress = {
  runId: string;
  status: string;
  phase: string;
  conversationsFound: number;
  transcriptsFetched: number;
  transcriptsCached: number;
  transcriptsFailed: number;
  transcriptsPending: number;
  customersFound: number;
  customersCreated: number;
  customersUpdated: number;
  droppedStale: number;
  droppedDuplicate: number;
  messagingEvents: number;
  workspaceNote: string | null;
  error: string | null;
  startedAt: string;
  finishedAt: string | null;
};

const PHASES = [
  { key: "conversations", label: "Conversations" },
  { key: "transcripts", label: "Transcripts" },
  { key: "customers", label: "Customers" },
  { key: "messaging", label: "Messaging" },
] as const;

const POLL_MS = 2000;

export type ServerDiagnostic = {
  vercelEnv: string | null;
  branch: string | null;
  commit: string | null;
  vars: Record<string, boolean>;
};


function phaseIndex(phase: string): number {
  const found = PHASES.findIndex((p) => p.key === phase);
  return found === -1 ? PHASES.length : found;
}

async function fetchProgress(): Promise<Progress | null> {
  const response = await fetch("/api/ingest", { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as Progress | { status: "idle" };
  return "runId" in body ? body : null;
}

type StartFailure = { title: string; detail: string; tone: "warning" | "critical" };

type SliceResult = { failure: StartFailure | null; progress: Progress | null };

/** How many continuations to run without asking. A full first pull of a few
 *  thousand calls takes a handful; the cap stops a runaway loop. */
const MAX_AUTO_SLICES = 12;

async function startRun(): Promise<SliceResult> {
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as Progress | null;
    return { failure: null, progress: body && "runId" in body ? body : null };
  }

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    detail?: unknown;
  };
  if (response.status === 501) {
    return {
      failure: {
      title: "Jobix is not configured on this server",
      detail:
        body.message ??
        "The voice platform sign-in is not configured on the server. An administrator must set JOBIX_EMAIL and JOBIX_PASSWORD.",
      tone: "warning",
      },
      progress: null,
    };
  }
  if (response.status === 409) {
    return {
      failure: {
      title: "Workspace mismatch — ingestion refused",
      detail:
        body.message ??
        "The token points at a different workspace than expected. The run was stopped before writing any data, because these endpoints return plausible data from the wrong workspace.",
      tone: "critical",
      },
      progress: null,
    };
  }
  if (response.status === 403) {
    return {
      failure: {
        title: "Unavailable in demo mode",
        detail: body.message ?? "Sign in with a real account to run ingestion.",
        tone: "warning",
      },
      progress: null,
    };
  }
  return {
    failure: {
      title: "Ingestion failed to start",
      detail: body.message ?? "Ingestion could not be started. Try again.",
      tone: "critical",
    },
    progress: null,
  };
}

function Counter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[0.6875rem] text-ink-3">{label}</p>
      <p className="num text-[0.875rem] font-medium text-ink">{count(value)}</p>
    </div>
  );
}

export function IngestionPanel({
  initial,
  configured,
  disabledReason,
  diagnostic,
}: {
  initial: Progress | null;
  /** Whether the server has Jobix credentials. Never the credentials themselves. */
  configured: boolean;
  /** Set when the viewer may not ingest at all (demo mode, or insufficient role). */
  disabledReason?: string;
  /** What the running deployment sees — presence booleans and build identity, no values. */
  diagnostic?: ServerDiagnostic;
}) {
  const [progress, setProgress] = useState<Progress | null>(initial);
  const [running, setRunning] = useState(initial?.status === "running");
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const [open, setOpen] = useState(initial?.status === "running");
  const [starts, setStarts] = useState(0);

  // Poll while a slice is in flight. The POST holds open for the whole slice,
  // so this is the only source of intermediate progress. An interrupted status
  // is NOT a stop — the slice effect below decides whether to continue.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = setInterval(() => {
      fetchProgress()
        .then((next) => {
          if (cancelled || !next) return;
          setProgress(next);
          if (next.status === "completed" || next.status === "failed") setRunning(false);
        })
        .catch(() => {
          /* a dropped poll is not a failed run — the next tick retries */
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running]);

  // Run one slice per bump of the counter, and bump it again while the server
  // reports an interrupted run — that status means "resumable", so continuing
  // is the correct behaviour rather than something to ask about.
  useEffect(() => {
    if (starts === 0) return;
    let cancelled = false;
    startRun()
      .then((result) => {
        if (cancelled) return null;
        if (result.failure) {
          setFailure(result.failure);
          setRunning(false);
          return null;
        }
        return result.progress ?? fetchProgress();
      })
      .then((next) => {
        if (cancelled || !next) return;
        setProgress(next);
        if (next.status === "interrupted") {
          if (starts < MAX_AUTO_SLICES) {
            setStarts((n) => n + 1);
          } else {
            setRunning(false);
          }
          return;
        }
        if (next.status !== "running") setRunning(false);
      })
      .catch(() => {
        if (cancelled) return;
        setFailure({
          title: "Ingestion failed to start",
          detail: "The request could not be sent. Check your connection and try again.",
          tone: "critical",
        });
        setRunning(false);
      });
    return () => {
      cancelled = true;
    };
  }, [starts]);

  // A deployment carrying only the static token is configured on paper but
  // cannot authenticate — the dashboard API rejects that token on every
  // endpoint. Say so before a run is spent finding out.
  const tokenOnly =
    !!diagnostic &&
    diagnostic.vars.JOBIX_TOKEN &&
    !(diagnostic.vars.JOBIX_EMAIL && diagnostic.vars.JOBIX_PASSWORD);
  const blocked =
    disabledReason ??
    (!configured
      ? "The voice platform connection is not configured."
      : tokenOnly
        ? "A sign-in is required: the dashboard API does not accept the static API token. Set JOBIX_EMAIL and JOBIX_PASSWORD."
        : undefined);
  const current = phaseIndex(progress?.phase ?? "conversations");
  const failed = progress?.status === "failed";
  const paused = progress?.status === "interrupted";
  const pending = progress?.transcriptsPending ?? 0;
  const remainingNote = pending > 0 ? `${count(pending)} transcripts still to fetch` : null;

  return (
    <section className="glass mb-4">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <ServerCog size={15} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-ink">Jobix ingestion</p>
          <p className="truncate text-[0.71875rem] text-ink-3">
            {running
              ? `Running — ${progress?.phase ?? "starting"} (part ${starts} of the pull)${
                  remainingNote ? ` · ${remainingNote}` : ""
                }…`
              : blocked
                ? blocked
                : paused
                  ? `Paused at the request time limit${remainingNote ? ` — ${remainingNote}` : ""}. Continue picks up where it stopped.`
                  : failed
                    ? "Last run did not complete — open Detail for the reason."
                    : progress?.finishedAt
                      ? `Last run finished ${formatDateTime(progress.finishedAt)} · ${count(progress.conversationsFound)} conversations`
                      : "No ingestion run recorded. Pulls conversations, transcripts, customers and messaging steps."}
          </p>
        </div>
        <button
          className="btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide ingestion detail" : "Show ingestion detail"}
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          Detail
        </button>
        <button
          className="btn btn-primary"
          disabled={running || !!blocked}
          title={blocked ?? (running ? "An ingestion run is already in progress" : "Pull the latest data from Jobix")}
          onClick={() => {
            setFailure(null);
            setRunning(true);
            setOpen(true);
            setStarts((n) => n + 1);
          }}
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {running ? "Running…" : paused ? "Continue" : progress ? "Run again" : "Run ingestion"}
        </button>
      </div>

      {open && (
        <div className="space-y-3.5 border-t border-line-2 px-4 py-3.5">
          {/* A disabled Run button needs a reason on the page, not only in a
              tooltip — otherwise the panel reads as broken. */}
          {blocked && (
            <div className="rounded-lg border border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)] px-3 py-2.5">
              <p className="flex items-start gap-2 text-[0.78125rem] font-medium text-[#f2c14e]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Ingestion is unavailable
              </p>
              <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">{blocked}</p>
            </div>
          )}

          {/* phase stepper */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PHASES.map((phase, index) => {
              const done = progress?.status === "completed" || index < current;
              const active = running && index === current;
              return (
                <span
                  key={phase.key}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] ${
                    done
                      ? "border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.1)] text-[#3ecf9a]"
                      : active
                        ? "border-[rgba(57,135,229,0.45)] bg-accent-soft text-ink"
                        : "border-line bg-white/[0.03] text-ink-3"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 size={11} />
                  ) : active ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : null}
                  {phase.label}
                </span>
              );
            })}
          </div>

          {progress && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              <Counter label="Conversations" value={progress.conversationsFound} hint="Calls returned by Jobix" />
              <Counter
                label="Transcripts new"
                value={progress.transcriptsFetched}
                hint="Fetched this run — cached transcripts are never re-fetched"
              />
              <Counter label="Cached" value={progress.transcriptsCached} hint="Already stored before this run" />
              <Counter
                label="Still to fetch"
                value={progress.transcriptsPending}
                hint="Transcripts left after this part of the pull — the next part continues with these"
              />
              <Counter
                label="Failed"
                value={progress.transcriptsFailed}
                hint="Transcript fetches that errored — a re-run retries only these"
              />
              <Counter
                label="Customers"
                value={progress.customersFound}
                hint={`After stale and duplicate filtering — ${progress.customersCreated} new debtors created, ${progress.customersUpdated} existing updated by phone match`}
              />
              <Counter
                label="Messaging"
                value={progress.messagingEvents}
                hint="WhatsApp/SMS and filter steps from flow node history"
              />
            </div>
          )}

          {progress && (progress.droppedStale > 0 || progress.droppedDuplicate > 0) && (
            <p className="text-[0.71875rem] text-ink-3">
              Dropped <span className="num">{progress.droppedStale}</span> stale and{" "}
              <span className="num">{progress.droppedDuplicate}</span> duplicate customer records — deduped by
              phone, keeping the most recently modified.
            </p>
          )}

          {progress?.workspaceNote && (
            <p className="text-[0.71875rem] text-ink-3">Workspace check: {progress.workspaceNote}</p>
          )}

          {paused && !running && (
            <div className="rounded-lg border border-[rgba(57,135,229,0.35)] bg-accent-soft px-3 py-2.5">
              <p className="text-[0.78125rem] font-medium text-ink">Paused, not failed</p>
              <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">
                A single server request cannot hold a pull of this size open, so the run stops itself before the
                platform cuts it off and everything fetched so far is kept.{" "}
                {remainingNote ? `There are ${remainingNote}. ` : ""}
                Press Continue to carry on from this point — nothing already stored is fetched twice.
              </p>
            </div>
          )}

          {failure && (
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                failure.tone === "critical"
                  ? "border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)]"
                  : "border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)]"
              }`}
            >
              <p
                className={`flex items-start gap-2 text-[0.78125rem] font-medium ${
                  failure.tone === "critical" ? "text-[#e2714a]" : "text-[#f2c14e]"
                }`}
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {failure.title}
              </p>
              <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">{failure.detail}</p>
            </div>
          )}

          {failed && progress?.error && !failure && (
            <div className="rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2.5">
              <p className="flex items-start gap-2 text-[0.78125rem] text-[#e2714a]">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {progress.error}
              </p>
            </div>
          )}

          <p className="border-t border-line-2 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
            Runs are resumable: transcripts already stored are never fetched again. A large pull is done in
            parts, continuing automatically until the book is complete or {MAX_AUTO_SLICES} parts have run.
            Refresh the page to recompute the analytics below with the newly ingested data.
          </p>

          {diagnostic && (
            <p className="num text-[0.65625rem] leading-relaxed text-ink-3">
              This deployment sees:{" "}
              {Object.entries(diagnostic.vars)
                .map(([name, present]) => `${name} ${present ? "✓" : "✗"}`)
                .join(" · ")}
              {" — env "}
              {diagnostic.vercelEnv ?? "?"}
              {diagnostic.branch ? ` · branch ${diagnostic.branch}` : ""}
              {diagnostic.commit ? ` · build ${diagnostic.commit}` : ""}
            </p>
          )}
        </div>
      )}
    </section>
  );
}
