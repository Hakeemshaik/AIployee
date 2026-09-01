"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  RefreshCw,
  ServerCog,
  Zap,
} from "lucide-react";
import { count, formatDate, formatDateTime } from "@/lib/format";
import { Select } from "@/components/Select";

// ---------------------------------------------------------------------------
// Ingestion control.
//
// Two things this has to get right, because both went wrong in practice:
//
//   * How much to pull. Asking for the whole provider database is a punishment
//     for a first run — so the operator picks a window, and the default is a
//     week rather than everything.
//   * Never look busy when nothing is happening. A pull of any size is done in
//     parts; the server stops each part before the platform's request ceiling
//     and reports "interrupted", which means resumable. Whoever notices that
//     status first — the poller or the part that just finished — starts the
//     next part, so a page reloaded mid-pull carries on instead of spinning.
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
  { key: "conversations", label: "Call list" },
  { key: "transcripts", label: "Transcripts" },
  { key: "customers", label: "Accounts" },
  { key: "messaging", label: "Messages" },
] as const;

const POLL_MS = 2000;

// --- how far back to pull ---------------------------------------------------

type WindowKey = "today" | "yesterday" | "7d" | "30d" | "all";

const WINDOWS: { key: WindowKey; label: string; days: number | null }[] = [
  { key: "today", label: "Today", days: 0 },
  { key: "yesterday", label: "Yesterday and today", days: 1 },
  { key: "7d", label: "Last 7 days", days: 6 },
  { key: "30d", label: "Last 30 days", days: 29 },
  { key: "all", label: "Everything on the platform", days: null },
];

/**
 * The instant a window starts: midnight South African time, that many days
 * back. SAST is UTC+2 with no daylight saving, so this is exact arithmetic
 * rather than a locale guess.
 */
function windowStart(key: WindowKey): Date | null {
  const days = WINDOWS.find((w) => w.key === key)?.days ?? null;
  if (days === null) return null;
  const sastNow = new Date(Date.now() + 2 * 3_600_000);
  const midnightSast = Date.UTC(
    sastNow.getUTCFullYear(),
    sastNow.getUTCMonth(),
    sastNow.getUTCDate() - days,
  );
  return new Date(midnightSast - 2 * 3_600_000);
}

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

function phaseLabel(phase: string): string {
  return PHASES.find((p) => p.key === phase)?.label.toLowerCase() ?? "starting";
}

async function fetchProgress(): Promise<Progress | null> {
  const response = await fetch("/api/ingest", { cache: "no-store" });
  if (!response.ok) return null;
  const body = (await response.json()) as Progress | { status: "idle" };
  return "runId" in body ? body : null;
}

type StartFailure = { title: string; detail: string; tone: "warning" | "critical" };

type SliceResult = { failure: StartFailure | null; progress: Progress | null };

/** How many parts to run without asking. A first pull of a few thousand calls
 *  takes a handful; the cap stops a runaway loop. */
const MAX_AUTO_PARTS = 12;

async function startRun(since: Date | null, skipTranscripts: boolean): Promise<SliceResult> {
  const response = await fetch("/api/ingest", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      ...(since ? { since: since.toISOString() } : {}),
      ...(skipTranscripts ? { skipTranscripts: true } : {}),
    }),
  });
  if (response.ok) {
    const body = (await response.json().catch(() => null)) as Progress | null;
    return { failure: null, progress: body && "runId" in body ? body : null };
  }

  // A body that is not JSON means the response did not come from the route at
  // all — the platform's own error page. The commonest cause is the request
  // exceeding the function duration ceiling, which must be named rather than
  // hidden behind "try again".
  const raw = await response.text();
  let body: { error?: string; message?: string; detail?: unknown } = {};
  let platformError = false;
  try {
    body = raw ? (JSON.parse(raw) as typeof body) : {};
  } catch {
    platformError = true;
  }
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
  if (platformError || response.status === 504) {
    return {
      failure: {
        title: "The run was cut off by the platform, not by Jobix",
        detail:
          "The server did not answer with a result — the request hit the hosting platform's time limit. Progress up to that point is kept, so press Continue to carry on from where it stopped.",
        tone: "warning",
      },
      progress: null,
    };
  }
  // The route reports a Jobix problem in `message` and an unexpected server
  // error in `error`. Reading only one of them turned every server error into
  // a contentless "try again".
  const reason = body.message ?? body.error;
  return {
    failure: {
      title: "Ingestion failed to start",
      detail: reason
        ? `The server reported: ${reason}`
        : `The server answered HTTP ${response.status} with no reason. Check the deployment logs for the /api/ingest request.`,
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
  const router = useRouter();
  const [progress, setProgress] = useState<Progress | null>(initial);
  const [running, setRunning] = useState(initial?.status === "running");
  const [failure, setFailure] = useState<StartFailure | null>(null);
  const [open, setOpen] = useState(initial?.status === "running");
  const [slice, setSlice] = useState(0);
  const [parts, setParts] = useState(0);
  const [windowKey, setWindowKey] = useState<WindowKey>("7d");
  const [quick, setQuick] = useState(false);

  // Refs, because the poller's interval closure would otherwise read the
  // values from the render that created it.
  const inFlight = useRef(false);
  const partsRef = useRef(0);
  // Captured when Import is pressed, so every automatic part of the same pull
  // uses the window the operator actually chose.
  const windowRef = useRef<WindowKey>("7d");
  const quickRef = useRef(false);

  /**
   * One place decides what a status means, so the poller and the part that
   * just finished cannot disagree — the bug that left a reloaded page
   * spinning was exactly that disagreement.
   */
  const applyProgress = useCallback(
    (next: Progress) => {
      setProgress(next);
      if (next.status === "completed" || next.status === "failed") {
        setRunning(false);
        // The analytics below are server-rendered from the data this run just
        // wrote, so they are stale the moment it finishes. Telling the operator
        // to refresh was not a feature.
        if (next.status === "completed") router.refresh();
        return;
      }
      if (next.status === "interrupted") {
        // Resumable. Continue unless a part is already in flight (that part
        // will decide when it lands) or the automatic cap is reached.
        if (inFlight.current) return;
        if (partsRef.current < MAX_AUTO_PARTS) setSlice((n) => n + 1);
        else setRunning(false);
      }
    },
    [router],
  );

  // Poll while a pull is in flight. The POST holds open for a whole part, so
  // this is the only source of intermediate progress.
  useEffect(() => {
    if (!running) return;
    let cancelled = false;
    const timer = setInterval(() => {
      fetchProgress()
        .then((next) => {
          if (cancelled || !next) return;
          applyProgress(next);
        })
        .catch(() => {
          /* a dropped poll is not a failed run — the next tick retries */
        });
    }, POLL_MS);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [running, applyProgress]);

  // Run one part per bump of the counter.
  useEffect(() => {
    if (slice === 0) return;
    let cancelled = false;
    inFlight.current = true;

    startRun(windowStart(windowRef.current), quickRef.current)
      .then(async (result) => {
        if (cancelled) return;
        if (result.failure) {
          inFlight.current = false;
          setFailure(result.failure);
          setRunning(false);
          return;
        }
        partsRef.current += 1;
        setParts(partsRef.current);
        const next = result.progress ?? (await fetchProgress());
        if (cancelled || !next) {
          inFlight.current = false;
          return;
        }
        // Cleared before applying, so applyProgress is free to start the next
        // part rather than assuming this one is still going.
        inFlight.current = false;
        applyProgress(next);
      })
      .catch(() => {
        inFlight.current = false;
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
  }, [slice, applyProgress]);

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
  const from = windowStart(windowKey);
  const windowLabel = WINDOWS.find((w) => w.key === windowKey)?.label ?? "";

  return (
    <section className="card mb-4">
      <div className="flex flex-wrap items-center gap-3 px-4 py-3">
        <ServerCog size={15} className="shrink-0 text-accent" />
        <div className="min-w-0 flex-1">
          <p className="text-[0.8125rem] font-medium text-ink">Import from Jobix</p>
          <p className="truncate text-[0.71875rem] text-ink-3">
            {running
              ? `Working on the ${phaseLabel(progress?.phase ?? "conversations")}${
                  parts > 1 ? `, part ${parts}` : ""
                }${remainingNote ? ` · ${remainingNote}` : ""}…`
              : failure
                // A banner in the body is not enough when the panel is
                // collapsed: the one line on show must carry the bad news.
                ? failure.title
                : blocked
                ? blocked
                : paused
                  ? `Paused part way${remainingNote ? ` — ${remainingNote}` : ""}. Continue picks up where it stopped.`
                  : failed
                    ? "Last import did not finish — open Detail for the reason."
                    : progress?.finishedAt
                      ? `Last import finished ${formatDateTime(progress.finishedAt)} · ${count(progress.conversationsFound)} calls`
                      : "Nothing imported yet. Choose how far back to pull, then press Import."}
          </p>
        </div>
        <Select
          className="w-auto min-w-[180px]"
          value={windowKey}
          onChange={(value) => setWindowKey(value as WindowKey)}
          disabled={running}
          aria-label="How far back to import"
          options={WINDOWS.map((option) => ({ value: option.key, label: option.label }))}
        />
        <button
          className={`btn ${quick ? "border-accent/45 bg-accent-soft text-ink" : ""}`}
          onClick={() => setQuick((v) => !v)}
          disabled={running}
          aria-pressed={quick}
          title="Pull the call list and accounts only. Seconds instead of minutes, but reach stays unverified until transcripts are fetched."
        >
          <Zap size={13} className={quick ? "text-accent" : ""} />
          Numbers only
        </button>
        <button
          className="btn"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          aria-label={open ? "Hide import detail" : "Show import detail"}
        >
          <ChevronDown size={13} className={`transition-transform ${open ? "rotate-180" : ""}`} />
          Detail
        </button>
        <button
          className="btn btn-primary"
          disabled={running || !!blocked}
          title={blocked ?? (running ? "An import is already running" : "Pull the latest data from Jobix")}
          onClick={() => {
            setFailure(null);
            setRunning(true);
            setOpen(true);
            windowRef.current = windowKey;
            quickRef.current = quick;
            partsRef.current = 0;
            setParts(0);
            setSlice((n) => n + 1);
          }}
        >
          {running ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          {running
            ? "Importing…"
            : paused
              ? "Continue"
              : quick
                ? "Quick import"
                : progress
                  ? "Import again"
                  : "Import"}
        </button>
      </div>

      {open && (
        <div className="space-y-3.5 border-t border-line-2 px-4 py-3.5">
          {/* A disabled button needs a reason on the page, not only in a
              tooltip — otherwise the panel reads as broken. */}
          {blocked && (
            <div className="rounded-lg border border-warning/30 bg-warning/7 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[0.78125rem] font-medium text-warning">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                Importing is unavailable
              </p>
              <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">{blocked}</p>
            </div>
          )}

          <p className="text-[0.71875rem] text-ink-2">
            {from
              ? `Pulling calls made on or after ${formatDate(from)} (${windowLabel.toLowerCase()}).`
              : "Pulling every call on the platform, however old."}{" "}
            <span className="text-ink-3">
              {quick
                ? "Numbers only: the call list and the accounts, no transcripts. Finishes in seconds — reach stays unverified until you import again without this on."
                : "A narrower window is faster: the slow part is one transcript request per call."}
            </span>
          </p>

          {/* what happens, in order */}
          <div className="flex flex-wrap items-center gap-1.5">
            {PHASES.map((phase, index) => {
              const done = progress?.status === "completed" || index < current;
              const active = running && index === current;
              return (
                <span
                  key={phase.key}
                  className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[0.6875rem] ${
                    done
                      ? "border-good/35 bg-good/10 text-good"
                      : active
                        ? "border-accent/45 bg-accent-soft text-ink"
                        : "border-line bg-ink/[0.03] text-ink-3"
                  }`}
                >
                  {done ? (
                    <CheckCircle2 size={11} />
                  ) : active ? (
                    <Loader2 size={11} className="animate-spin" />
                  ) : null}
                  {index + 1}. {phase.label}
                </span>
              );
            })}
          </div>

          {progress && (
            <div className="grid grid-cols-3 gap-3 sm:grid-cols-7">
              <Counter label="Calls" value={progress.conversationsFound} hint="Call records returned by Jobix" />
              <Counter
                label="Transcripts new"
                value={progress.transcriptsFetched}
                hint="Fetched this run — cached transcripts are never re-fetched"
              />
              <Counter label="Cached" value={progress.transcriptsCached} hint="Already stored before this run" />
              <Counter
                label="Still to fetch"
                value={progress.transcriptsPending}
                hint="Transcripts left after this part — the next part continues with these"
              />
              <Counter
                label="Failed"
                value={progress.transcriptsFailed}
                hint="Transcript fetches that errored — a re-run retries only these"
              />
              <Counter
                label="Accounts"
                value={progress.customersFound}
                hint={`After stale and duplicate filtering — ${progress.customersCreated} new debtors created, ${progress.customersUpdated} existing updated by phone match`}
              />
              <Counter
                label="Messages"
                value={progress.messagingEvents}
                hint="WhatsApp/SMS and filter steps from flow node history"
              />
            </div>
          )}

          {progress && (progress.droppedStale > 0 || progress.droppedDuplicate > 0) && (
            <p className="text-[0.71875rem] text-ink-3">
              Dropped <span className="num">{progress.droppedStale}</span> stale and{" "}
              <span className="num">{progress.droppedDuplicate}</span> duplicate account records — deduped by
              phone, keeping the most recently modified.
            </p>
          )}

          {progress?.workspaceNote && (
            <p className="text-[0.71875rem] text-ink-3">Workspace check: {progress.workspaceNote}</p>
          )}

          {paused && !running && (
            <div className="rounded-lg border border-accent/35 bg-accent-soft px-3 py-2.5">
              <p className="text-[0.78125rem] font-medium text-ink">Paused, not failed</p>
              <p className="mt-1 text-[0.71875rem] leading-relaxed text-ink-2">
                A single server request cannot hold a pull of this size open, so it stops itself before the
                platform cuts it off and everything fetched so far is kept.{" "}
                {remainingNote ? `There are ${remainingNote}. ` : ""}
                Press Continue to carry on from this point — nothing already stored is fetched twice. A shorter
                window finishes in one part.
              </p>
            </div>
          )}

          {failure && (
            <div
              className={`rounded-lg border px-3 py-2.5 ${
                failure.tone === "critical"
                  ? "border-serious/35 bg-serious/8"
                  : "border-warning/30 bg-warning/7"
              }`}
            >
              <p
                className={`flex items-start gap-2 text-[0.78125rem] font-medium ${
                  failure.tone === "critical" ? "text-serious" : "text-warning"
                }`}
              >
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {failure.title}
              </p>
              <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">{failure.detail}</p>
            </div>
          )}

          {failed && progress?.error && !failure && (
            <div className="rounded-lg border border-serious/35 bg-serious/8 px-3 py-2.5">
              <p className="flex items-start gap-2 text-[0.78125rem] text-serious">
                <AlertTriangle size={13} className="mt-0.5 shrink-0" />
                {progress.error}
              </p>
            </div>
          )}

          <p className="border-t border-line-2 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
            Imports are resumable: a transcript already stored is never fetched again, so pressing Import after
            an interrupted one continues rather than restarts. A large pull runs in parts automatically, up to{" "}
            {MAX_AUTO_PARTS}. Refresh the page to recompute the analytics below with the newly imported data.
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
