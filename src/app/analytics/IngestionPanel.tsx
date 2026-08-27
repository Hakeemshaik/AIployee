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
import { formatDateTime } from "@/lib/format";

// ---------------------------------------------------------------------------
// Ingestion control.
//
// A run is resumable by design — cached transcripts are never re-fetched — so
// the honest thing to show is phase, counters and the fact that pressing Run
// again continues rather than restarts.
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

async function startRun(): Promise<StartFailure | null> {
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({}),
  });
  if (response.ok) return null;

  const body = (await response.json().catch(() => ({}))) as {
    error?: string;
    message?: string;
    detail?: unknown;
  };
  if (response.status === 501) {
    return {
      title: "Jobix is not configured on this server",
      detail:
        body.message ??
        "The voice platform sign-in is not configured on the server. An administrator must set JOBIX_EMAIL and JOBIX_PASSWORD.",
      tone: "warning",
    };
  }
  if (response.status === 409) {
    return {
      title: "Workspace mismatch — ingestion refused",
      detail:
        body.message ??
        "The token points at a different workspace than expected. The run was stopped before writing any data, because these endpoints return plausible data from the wrong workspace.",
      tone: "critical",
    };
  }
  if (response.status === 403) {
    return {
      title: "Unavailable in demo mode",
      detail: body.message ?? "Sign in with a real account to run ingestion.",
      tone: "warning",
    };
  }
  return {
    title: "Ingestion failed to start",
    detail: body.message ?? "Ingestion could not be started. Try again.",
    tone: "critical",
  };
}

function Counter({ label, value, hint }: { label: string; value: number; hint?: string }) {
  return (
    <div title={hint}>
      <p className="text-[0.6875rem] text-ink-3">{label}</p>
      <p className="num text-[0.875rem] font-medium text-ink">{value.toLocaleString("en-ZA")}</p>
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

  // Poll while a run is in flight. The POST holds open for the whole run, so
  // this is the only source of intermediate progress.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = setInterval(() => {
      fetchProgress()
        .then((next) => {
          if (cancelled || !next) return;
          setProgress(next);
          if (next.status !== "running") setRunning(false);
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

  // Kick off a run when the button bumps the counter.
  useEffect(() => {
    if (starts === 0) return;
    let cancelled = false;
    startRun()
      .then((problem) => {
        if (cancelled) return;
        if (problem) {
          setFailure(problem);
          setRunning(false);
        }
        return fetchProgress();
      })
      .then((next) => {
        if (cancelled || !next) return;
        setProgress(next);
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

  return (
    <section className="glass mb-4">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <ServerCog size={15} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-ink">Jobix ingestion</p>
          <p className="truncate text-[0.71875rem] text-ink-3">
            {running
              ? `Running — ${progress?.phase ?? "starting"}…`
              : blocked
                ? blocked
                : failed
                  ? "Last run did not complete — open Detail for the reason."
                  : progress?.finishedAt
                    ? `Last run finished ${formatDateTime(progress.finishedAt)} · ${progress.conversationsFound.toLocaleString("en-ZA")} conversations`
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
          {running ? "Running…" : progress ? "Run again" : "Run ingestion"}
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
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-6">
              <Counter label="Conversations" value={progress.conversationsFound} hint="Calls returned by Jobix" />
              <Counter
                label="Transcripts new"
                value={progress.transcriptsFetched}
                hint="Fetched this run — cached transcripts are never re-fetched"
              />
              <Counter label="Cached" value={progress.transcriptsCached} hint="Already stored before this run" />
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
            Runs are resumable: transcripts already stored are never fetched again, so pressing Run after an
            interrupted run continues where it stopped. Refresh the page to recompute the analytics below with
            the newly ingested data.
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
