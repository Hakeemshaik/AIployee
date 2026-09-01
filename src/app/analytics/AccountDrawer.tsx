"use client";

import { useEffect, useState } from "react";
import {
  AlertTriangle,
  CheckCircle2,
  ChevronDown,
  Loader2,
  MessageSquare,
  PhoneCall,
  RefreshCw,
  X,
  XCircle,
} from "lucide-react";
import { formatDateTime, money } from "@/lib/format";
import { Badge } from "@/components/ui";

// ---------------------------------------------------------------------------
// Per-account drawer.
//
// The table says which bucket an account is in; this says why. Each call shows
// its own reach verdict with the reasoning, the transcript that produced it,
// and — deliberately alongside rather than instead — the provider's own
// voicemail flag, so a disagreement is visible instead of hidden.
// ---------------------------------------------------------------------------

type Turn = { role: string; text: string };

type JourneyCall = {
  conversationUuid: string;
  attempt: number;
  startedAt: string;
  durationSeconds: number;
  agentName: string | null;
  flowName: string | null;
  voicemailFlag: boolean;
  reached: boolean;
  reason: string;
  transcriptAvailable: boolean;
  tenantWords: number;
  turns: Turn[];
};

type MessagingEvent = {
  channel: string;
  channelLabel: string;
  nodeName: string | null;
  succeeded: boolean;
  failed: boolean;
  matchedFilter: boolean | null;
  occurredAt: string;
};

export type Journey = {
  accountId: string;
  name: string;
  phone: string;
  unit: string | null;
  building: string | null;
  balance: number;
  bucket: string;
  attempts: number;
  firstReachAttempt: number | null;
  tenantWords: number;
  flags: {
    hasPtp: boolean;
    ptpAmount: number | null;
    disputed: boolean;
    paidClaimed: boolean;
    escalated: boolean;
    doNotCall: boolean;
  };
  calls: JourneyCall[];
  messaging: { basis: string; note: string; events: MessagingEvent[] };
};

async function fetchJourney(id: string): Promise<Journey> {
  const response = await fetch(`/api/accounts/${encodeURIComponent(id)}/journey`, {
    cache: "no-store",
  });
  if (!response.ok) {
    throw new Error(
      response.status === 404
        ? "This account could not be found."
        : "This account could not be loaded.",
    );
  }
  return (await response.json()) as Journey;
}

function CallTurns({ turns }: { turns: Turn[] }) {
  if (turns.length === 0) {
    return (
      <p className="px-1 py-2 text-[0.75rem] text-ink-3">
        The transcript is cached but held no readable turns.
      </p>
    );
  }
  return (
    <div className="space-y-2.5 pt-1">
      {turns.map((turn, i) => {
        const isTenant = turn.role === "user";
        return (
          <div key={i} className={`flex ${isTenant ? "justify-end" : ""}`}>
            <div
              className={`max-w-[88%] rounded-xl px-3 py-2 text-[0.78125rem] leading-relaxed ${
                isTenant
                  ? "rounded-tr-sm border border-accent/28 bg-accent/11 text-ink"
                  : "rounded-tl-sm border border-line bg-white/[0.035] text-ink-2"
              }`}
            >
              <p
                className={`mb-0.5 text-[0.5625rem] font-medium uppercase tracking-[0.08em] ${
                  isTenant ? "text-accent" : "text-ink-3"
                }`}
              >
                {isTenant ? "Account holder" : "AI agent"}
              </p>
              {turn.text}
            </div>
          </div>
        );
      })}
    </div>
  );
}

function CallRow({ call, defaultOpen }: { call: JourneyCall; defaultOpen: boolean }) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div className="card-2">
      <button
        onClick={() => setOpen((v) => !v)}
        className="flex w-full items-start gap-3 px-3.5 py-3 text-left"
        aria-expanded={open}
      >
        <span
          className={`mt-0.5 flex h-6 w-6 shrink-0 items-center justify-center rounded-full border text-[0.625rem] font-semibold ${
            call.reached
              ? "border-good/40 bg-good/14 text-good"
              : "border-line bg-white/[0.04] text-ink-3"
          }`}
        >
          {call.attempt}
        </span>
        <span className="min-w-0 flex-1">
          <span className="flex flex-wrap items-center gap-2">
            <span className="text-[0.8125rem] font-medium text-ink">
              {call.reached ? "Reached" : "Not reached"}
            </span>
            <span className="num text-[0.71875rem] text-ink-3">
              {formatDateTime(call.startedAt)} · {call.durationSeconds}s
            </span>
            {call.voicemailFlag && (
              <span
                className="rounded-full border border-line bg-white/[0.04] px-1.5 py-0.5 text-[0.5625rem] uppercase tracking-[0.06em] text-ink-3"
                title="The provider flagged this call as voicemail. The flag is shown for reference only — it is unreliable and is never used to decide reach."
              >
                provider: voicemail
              </span>
            )}
          </span>
          <span className="mt-1 block text-[0.71875rem] leading-relaxed text-ink-2">{call.reason}</span>
        </span>
        <ChevronDown
          size={15}
          className={`mt-1 shrink-0 text-ink-3 transition-transform ${open ? "rotate-180" : ""}`}
        />
      </button>
      {open && (
        <div className="border-t border-line-2 px-3.5 pb-3.5">
          {call.transcriptAvailable ? (
            <CallTurns turns={call.turns} />
          ) : (
            <p className="pt-3 text-[0.75rem] text-ink-3">
              No transcript has been fetched for this call, so reach cannot be verified from content.
              Run ingestion to pull it.
            </p>
          )}
          <dl className="mt-3 flex flex-wrap gap-x-5 gap-y-1 border-t border-line-2 pt-2.5 text-[0.6875rem] text-ink-3">
            <span>
              Agent <span className="text-ink-2">{call.agentName ?? "—"}</span>
            </span>
            <span>
              Flow <span className="text-ink-2">{call.flowName ?? "—"}</span>
            </span>
            <span>
              Tenant words <span className="num text-ink-2">{call.tenantWords}</span>
            </span>
            <span>
              Call <span className="num text-ink-2">{call.conversationUuid}</span>
            </span>
          </dl>
        </div>
      )}
    </div>
  );
}

function Messaging({ messaging }: { messaging: Journey["messaging"] }) {
  return (
    <div>
      <p
        className={`mb-2.5 flex items-start gap-2 rounded-lg border px-3 py-2 text-[0.71875rem] leading-relaxed ${
          messaging.basis === "ambiguous_name"
            ? "border-warning/30 bg-warning/7 text-warning"
            : "border-line bg-white/[0.03] text-ink-3"
        }`}
      >
        {messaging.basis === "ambiguous_name" && <AlertTriangle size={13} className="mt-0.5 shrink-0" />}
        {messaging.note}
      </p>
      {messaging.events.length === 0 ? (
        <p className="text-[0.78125rem] text-ink-3">No WhatsApp, SMS or other flow steps recorded.</p>
      ) : (
        <ul className="space-y-1.5">
          {messaging.events.map((event, i) => (
            <li
              key={i}
              className="flex items-center gap-2.5 rounded-lg border border-line bg-white/[0.02] px-3 py-2"
            >
              {event.succeeded ? (
                <CheckCircle2 size={14} className="shrink-0 text-good" />
              ) : (
                <XCircle size={14} className="shrink-0 text-serious" />
              )}
              <span className="min-w-0 flex-1">
                <span className="block text-[0.78125rem] text-ink">
                  {event.channelLabel}
                  {event.nodeName && event.nodeName !== event.channelLabel && (
                    <span className="text-ink-3"> · {event.nodeName}</span>
                  )}
                </span>
                <span className="num block text-[0.6875rem] text-ink-3">
                  {formatDateTime(event.occurredAt)}
                  {event.matchedFilter !== null && (
                    <span> · filter {event.matchedFilter ? "matched" : "did not match"}</span>
                  )}
                </span>
              </span>
              <span className="shrink-0 text-[0.6875rem] text-ink-3">
                {event.succeeded ? "sent" : "failed"}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

type DrawerProps = {
  accountId: string;
  onClose: () => void;
  bucketLabels: Record<string, string>;
  bucketExplanations: Record<string, string>;
};

/**
 * Mounted per account via a key, so switching accounts remounts with fresh
 * state instead of resetting it from an effect.
 */
function DrawerBody({ accountId, onClose, bucketLabels, bucketExplanations }: DrawerProps) {
  const [journey, setJourney] = useState<Journey | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "error">("loading");
  const [error, setError] = useState("");
  const [attempt, setAttempt] = useState(0);

  useEffect(() => {
    let cancelled = false;
    fetchJourney(accountId)
      .then((data) => {
        if (cancelled) return;
        setJourney(data);
        setError("");
        setState("idle");
      })
      .catch((err: unknown) => {
        if (cancelled) return;
        setError(err instanceof Error ? err.message : "Could not load this account.");
        setState("error");
      });
    // A drawer closed mid-flight must not write into unmounted state.
    return () => {
      cancelled = true;
    };
  }, [accountId, attempt]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onClose]);

  return (
    <div className="fixed inset-0 z-50 flex justify-end" role="dialog" aria-modal="true" aria-label="Account detail">
      <div className="absolute inset-0 bg-black/55 backdrop-blur-sm" onClick={onClose} />
      <div className="relative flex h-full w-full max-w-[620px] flex-col border-l border-line bg-plane shadow-2xl">
        <div className="flex items-start justify-between gap-3 border-b border-line px-5 py-4">
          <div className="min-w-0">
            <h2 className="truncate text-[0.9375rem] font-semibold tracking-tight text-ink">
              {journey?.name ?? "Loading account…"}
            </h2>
            {journey && (
              <p className="num mt-0.5 text-[0.75rem] text-ink-3">
                {journey.unit ?? "—"} · {journey.building ?? "—"} · {journey.phone}
              </p>
            )}
          </div>
          <button
            onClick={onClose}
            aria-label="Close account detail"
            className="shrink-0 rounded-lg p-1.5 text-ink-3 hover:bg-white/[0.05] hover:text-ink"
          >
            <X size={17} />
          </button>
        </div>

        <div className="flex-1 space-y-5 overflow-y-auto px-5 py-5">
          {state === "loading" && (
            <p className="flex items-center gap-2 py-10 text-[0.8125rem] text-ink-3">
              <Loader2 size={14} className="animate-spin" /> Loading call history…
            </p>
          )}

          {state === "error" && (
            <div className="rounded-xl border border-serious/35 bg-serious/8 p-4">
              <p className="flex items-start gap-2 text-[0.8125rem] text-serious">
                <AlertTriangle size={14} className="mt-0.5 shrink-0" />
                {error}
              </p>
              <button
                className="btn mt-3"
                onClick={() => {
                  setState("loading");
                  setError("");
                  setAttempt((n) => n + 1);
                }}
              >
                <RefreshCw size={13} /> Try again
              </button>
            </div>
          )}

          {journey && state === "idle" && (
            <>
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                <div>
                  <p className="text-[0.6875rem] text-ink-3">Balance</p>
                  <p className="num text-[0.9375rem] font-semibold text-ink">{money(journey.balance)}</p>
                </div>
                <div>
                  <p className="text-[0.6875rem] text-ink-3">Attempts</p>
                  <p className="num text-[0.9375rem] font-semibold text-ink">{journey.attempts}</p>
                </div>
                <div>
                  <p className="text-[0.6875rem] text-ink-3">First reached on</p>
                  <p className="num text-[0.9375rem] font-semibold text-ink">
                    {journey.firstReachAttempt ? `attempt ${journey.firstReachAttempt}` : "—"}
                  </p>
                </div>
                <div>
                  <p className="text-[0.6875rem] text-ink-3">Most words said</p>
                  <p className="num text-[0.9375rem] font-semibold text-ink">{journey.tenantWords}</p>
                </div>
              </div>

              <div className="flex flex-wrap items-center gap-1.5">
                <span title={bucketExplanations[journey.bucket]}>
                  <Badge
                    value={
                      journey.bucket === "conversation"
                        ? "promise_to_pay"
                        : journey.bucket === "answered_few_words"
                          ? "callback_requested"
                          : journey.bucket === "connected_no_conversation"
                            ? "voicemail"
                            : journey.bucket === "never_connected"
                              ? "failed"
                              : "neutral"
                    }
                    label={bucketLabels[journey.bucket] ?? journey.bucket}
                  />
                </span>
                {journey.flags.hasPtp && (
                  <Badge
                    value="fulfilled"
                    label={
                      journey.flags.ptpAmount
                        ? `PTP ${money(journey.flags.ptpAmount)}`
                        : "PTP — no amount stated"
                    }
                  />
                )}
                {journey.flags.disputed && <Badge value="dispute" label="Disputed" />}
                {journey.flags.paidClaimed && <Badge value="paid_in_full_claimed" label="Payment claimed" />}
                {journey.flags.escalated && <Badge value="escalated" label="Escalated" />}
                {journey.flags.doNotCall && <Badge value="opted_out" label="Do not call" />}
              </div>

              <section>
                <h3 className="mb-2.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
                  <PhoneCall size={14} className="text-accent" /> Call history
                  <span className="num font-normal text-ink-3">{journey.calls.length}</span>
                </h3>
                {journey.calls.length === 0 ? (
                  <p className="card-2 px-3.5 py-3 text-[0.78125rem] text-ink-3">
                    This account has never been called.
                  </p>
                ) : (
                  <div className="space-y-2">
                    {journey.calls.map((call) => (
                      <CallRow
                        key={call.conversationUuid}
                        call={call}
                        // Open the call that decided the outcome, or the last attempt.
                        defaultOpen={
                          journey.firstReachAttempt
                            ? call.attempt === journey.firstReachAttempt
                            : call.attempt === journey.calls.length
                        }
                      />
                    ))}
                  </div>
                )}
              </section>

              <section>
                <h3 className="mb-2.5 flex items-center gap-2 text-[0.8125rem] font-semibold text-ink">
                  <MessageSquare size={14} className="text-accent" /> Messaging steps
                  <span className="num font-normal text-ink-3">{journey.messaging.events.length}</span>
                </h3>
                <Messaging messaging={journey.messaging} />
              </section>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export function AccountDrawer({
  accountId,
  ...rest
}: Omit<DrawerProps, "accountId"> & { accountId: string | null }) {
  if (!accountId) return null;
  return <DrawerBody key={accountId} accountId={accountId} {...rest} />;
}
