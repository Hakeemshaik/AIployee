"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CalendarClock,
  CheckCircle2,
  Clock,
  PhoneOff,
  PhoneOutgoing,
  Play,
  Radio,
  Search,
} from "lucide-react";
import { label } from "@/lib/domain";
import { formatDayMonth, money } from "@/lib/format";

// ---------------------------------------------------------------------------
// What happened on the call.
//
// One dial has four states and this panel only ever shows one of them:
//
//   placed     the customer is written and the flow has it — the phone is
//              ringing, or about to
//   reached    somebody answered, and here is what they said
//   no_answer  nobody picked up, or it went to voicemail
//   failed     the platform could not place it
//
// It polls while the call is open and stops the moment a result lands, so the
// page is not asking a question nobody is going to answer. After twenty
// minutes with nothing it says so plainly rather than spinning for ever —
// "waiting" that never ends is the same lie as "sent" that never arrived.
// ---------------------------------------------------------------------------

export type DialAttemptView = {
  id: string;
  suid: string;
  name: string;
  phone: string;
  state: string;
  requestedAt: string;
  endedAt: string | null;
  durationSeconds: number | null;
  outcome: string | null;
  transcript: string | null;
  recordingUrl: string | null;
  callId: string | null;
  debtorId: string | null;
  analysis: {
    summary: string | null;
    sentiment: string | null;
    requiresHuman: boolean;
    nextAction: string | null;
  } | null;
  promise: { id: string; amount: number; promisedDate: string } | null;
  waitingSeconds: number;
};

const GRACE_SECONDS = 20 * 60;

function duration(seconds: number | null): string {
  if (seconds === null) return "—";
  if (seconds < 60) return `${seconds}s`;
  const minutes = Math.floor(seconds / 60);
  return `${minutes}m ${String(seconds % 60).padStart(2, "0")}s`;
}

function when(iso: string): string {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit" });
}

/** Agent and customer turns, told apart by eye. */
function Transcript({ text }: { text: string }) {
  const turns = text
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const match = /^(Agent|Customer)\s*:\s*(.*)$/i.exec(line);
      return match
        ? { who: match[1].toLowerCase() === "agent" ? "agent" : "customer", text: match[2] }
        : { who: "customer", text: line };
    });
  return (
    <div className="space-y-1.5">
      {turns.map((turn, index) => (
        <p
          key={index}
          className={`rise-in max-w-[85%] rounded-2xl px-3 py-2 text-[0.78125rem] leading-relaxed ${
            turn.who === "agent"
              ? "bg-accent/10 text-ink"
              : "ml-auto bg-ink/[0.05] text-ink"
          }`}
          style={{ ["--i" as string]: Math.min(index, 12) }}
        >
          {turn.text}
        </p>
      ))}
    </div>
  );
}

export function CallResult({
  attemptId,
  initial,
  compact = false,
}: {
  attemptId: string;
  initial?: DialAttemptView;
  compact?: boolean;
}) {
  const [attempt, setAttempt] = useState<DialAttemptView | null>(initial ?? null);
  const [failed, setFailed] = useState(false);
  const [looking, setLooking] = useState(false);
  const [lookNote, setLookNote] = useState<string | null>(null);

  const open = !attempt || (attempt.state === "placed" && attempt.waitingSeconds <= GRACE_SECONDS);

  useEffect(() => {
    // Only while the call is open. A finished dial never changes again, so
    // polling it would be asking a question that has already been answered.
    if (!open) return;

    let live = true;
    const tick = async () => {
      try {
        const response = await fetch(`/api/calling/one/${attemptId}`, { cache: "no-store" });
        if (!response.ok) throw new Error(String(response.status));
        const body = (await response.json()) as DialAttemptView;
        if (live) setAttempt(body);
      } catch {
        if (live) setFailed(true);
      }
    };
    void tick();
    const timer = setInterval(tick, 4000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [attemptId, open]);

  // The platform is asked for the result every twenty seconds while the call is
  // open, which is what makes this work on a deployment whose flow does not
  // post outcomes back. It is a read, and it stops the moment a result lands.
  useEffect(() => {
    if (!open) return;
    let live = true;
    const look = async () => {
      if (!live) return;
      try {
        const response = await fetch(`/api/calling/one/${attemptId}/fetch`, { method: "POST" });
        const body = await response.json();
        if (!live) return;
        if (body.attempt) setAttempt(body.attempt as DialAttemptView);
        if (body.found === false && typeof body.reason === "string") setLookNote(body.reason);
      } catch {
        // The poll above is still running; one failed read is not worth saying.
      }
    };
    const timer = setInterval(look, 20_000);
    return () => {
      live = false;
      clearInterval(timer);
    };
  }, [attemptId, open]);

  async function lookNow() {
    setLooking(true);
    setLookNote(null);
    try {
      const response = await fetch(`/api/calling/one/${attemptId}/fetch`, { method: "POST" });
      const body = await response.json();
      if (body.attempt) setAttempt(body.attempt as DialAttemptView);
      if (body.found === false) setLookNote(body.reason ?? "Nothing yet.");
      if (body.message) setLookNote(body.message as string);
    } catch {
      setLookNote("The platform could not be reached just now.");
    } finally {
      setLooking(false);
    }
  }

  if (!attempt) {
    return (
      <p className="flex items-center gap-2 text-[0.78125rem] text-ink-3">
        <Clock size={13} className="animate-spin" /> Looking for the call…
      </p>
    );
  }

  const stale = attempt.state === "placed" && attempt.waitingSeconds > GRACE_SECONDS;
  // A dial the sweep gave up on: the record was written and the flow took it,
  // and then nothing ever came back. That is not the same as a call that failed
  // to go out, and it must not be told as one.
  const unreported = attempt.state === "failed" && attempt.outcome === "no_outcome_reported";
  const tone =
    attempt.state === "reached"
      ? "border-good/35 bg-good/[0.07]"
      : unreported || stale
        ? "border-warning/35 bg-warning/[0.07]"
        : attempt.state === "failed"
          ? "border-critical/35 bg-critical/[0.06]"
          : attempt.state === "no_answer"
            ? "border-line bg-ink/[0.03]"
            : "border-accent/35 bg-accent/[0.06]";

  return (
    <div className={`rise-in rounded-2xl border px-4 py-3.5 ${tone}`}>
      {/* --- the headline: one line saying what happened --- */}
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1.5">
        {attempt.state === "placed" && !stale && (
          <>
            <span className="relative flex h-2.5 w-2.5 shrink-0">
              <span className="pulse-live absolute inline-flex h-full w-full rounded-full bg-accent" />
            </span>
            <span className="text-[0.875rem] font-semibold text-ink">Calling {attempt.name}</span>
            <span className="text-[0.75rem] text-ink-2">
              the flow has the record — {attempt.phone} is ringing
            </span>
          </>
        )}
        {attempt.state === "placed" && stale && (
          <>
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            <span className="text-[0.875rem] font-semibold text-ink">No result came back</span>
            <span className="text-[0.75rem] text-ink-2">
              placed at {when(attempt.requestedAt)} and nothing has reported since
            </span>
          </>
        )}
        {attempt.state === "reached" && (
          <>
            <CheckCircle2 size={15} className="shrink-0 text-good" />
            <span className="text-[0.875rem] font-semibold text-ink">
              {attempt.name} answered
            </span>
            <span className="num text-[0.75rem] text-ink-2">
              {duration(attempt.durationSeconds)} · {when(attempt.requestedAt)}
            </span>
          </>
        )}
        {attempt.state === "no_answer" && (
          <>
            <PhoneOff size={15} className="shrink-0 text-ink-3" />
            <span className="text-[0.875rem] font-semibold text-ink">Nobody answered</span>
            <span className="text-[0.75rem] text-ink-2">
              {attempt.phone} · {when(attempt.requestedAt)}
            </span>
          </>
        )}
        {attempt.state === "failed" && !unreported && (
          <>
            <AlertTriangle size={15} className="shrink-0 text-critical" />
            <span className="text-[0.875rem] font-semibold text-ink">The call did not go out</span>
            <span className="text-[0.75rem] text-ink-2">{attempt.phone}</span>
          </>
        )}
        {unreported && (
          <>
            <AlertTriangle size={15} className="shrink-0 text-warning" />
            <span className="text-[0.875rem] font-semibold text-ink">No result ever came back</span>
            <span className="text-[0.75rem] text-ink-2">
              {attempt.phone} · placed {when(attempt.requestedAt)}
            </span>
          </>
        )}
      </div>

      {/* --- the outcome, which is the reason anybody called --- */}
      {attempt.outcome && !unreported && (
        <p className="mt-2.5 flex flex-wrap items-center gap-2">
          <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-white/70 px-2.5 py-1 text-[0.75rem] font-medium text-ink">
            <PhoneOutgoing size={11} className="text-ink-3" />
            {label(attempt.outcome)}
          </span>
          {attempt.promise && (
            <span className="value-in inline-flex items-center gap-1.5 rounded-full border border-good/35 bg-good/10 px-2.5 py-1 text-[0.75rem] font-semibold text-good">
              <CalendarClock size={11} />
              {money(attempt.promise.amount)} by {formatDayMonth(attempt.promise.promisedDate)}
            </span>
          )}
          {attempt.analysis?.requiresHuman && (
            <span className="inline-flex items-center gap-1.5 rounded-full border border-serious/35 bg-serious/10 px-2.5 py-1 text-[0.75rem] font-medium text-serious">
              <AlertTriangle size={11} /> Needs a person
            </span>
          )}
          {attempt.analysis?.sentiment && (
            <span className="text-[0.71875rem] text-ink-3">
              {label(attempt.analysis.sentiment)} tone
            </span>
          )}
        </p>
      )}

      {attempt.analysis?.summary && (
        <p className="mt-2.5 text-[0.8125rem] leading-relaxed text-ink">{attempt.analysis.summary}</p>
      )}
      {attempt.analysis?.nextAction && (
        <p className="mt-1.5 text-[0.75rem] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">Next:</span> {attempt.analysis.nextAction}
        </p>
      )}

      {attempt.state === "placed" && !stale && (
        <p className="mt-2 text-[0.71875rem] leading-relaxed text-ink-3">
          The result lands here on its own — the transcript, whether a person answered, and any
          promise to pay. Nothing to press.
        </p>
      )}
      {unreported && (
        <p className="mt-2 text-[0.71875rem] leading-relaxed text-ink-2">
          The platform was asked for this call&rsquo;s result until it was too old to match a
          conversation to safely. Whether it was answered is not recorded, because nobody knows.
          Point the flow&rsquo;s call webhook at{" "}
          <code className="rounded bg-ink/[0.06] px-1 py-0.5">
            /api/integrations/voice/dial-outcome
          </code>{" "}
          and results arrive the moment a call ends.
        </p>
      )}
      {stale && (
        <p className="mt-2 text-[0.71875rem] leading-relaxed text-ink-2">
          The record was written and the flow accepted it, so either the call has not run yet or the
          platform is not posting outcomes back. Look for it now, or point the flow&rsquo;s call
          webhook at{" "}
          <code className="rounded bg-ink/[0.06] px-1 py-0.5">/api/integrations/voice/dial-outcome</code>{" "}
          and it will fill in by itself.
        </p>
      )}

      {attempt.state === "placed" && (
        <div className="mt-2.5 flex flex-wrap items-center gap-2">
          <button className="btn btn-sm" onClick={lookNow} disabled={looking}>
            {looking ? <Clock size={12} className="animate-spin" /> : <Search size={12} />}
            {looking ? "Looking on the platform…" : "Look for the result now"}
          </button>
          {lookNote && <span className="text-[0.6875rem] leading-relaxed text-ink-3">{lookNote}</span>}
        </div>
      )}

      {/* --- what was actually said --- */}
      {attempt.transcript && !compact && (
        <details className="group mt-3">
          <summary className="inline-flex cursor-pointer items-center gap-1.5 text-[0.75rem] font-medium text-accent-ink">
            <Radio size={12} /> Read the conversation
          </summary>
          <div className="page-in mt-2.5 border-t border-line-2 pt-2.5">
            <Transcript text={attempt.transcript} />
          </div>
        </details>
      )}

      {attempt.recordingUrl && (
        <a
          href={attempt.recordingUrl}
          target="_blank"
          rel="noreferrer"
          className="mt-2.5 inline-flex items-center gap-1.5 text-[0.75rem] text-accent-ink hover:underline"
        >
          <Play size={11} /> Listen to the recording
        </a>
      )}

      {failed && (
        <p className="mt-2 text-[0.71875rem] text-ink-3">
          The page could not reach the server for an update. It will keep trying.
        </p>
      )}
    </div>
  );
}
