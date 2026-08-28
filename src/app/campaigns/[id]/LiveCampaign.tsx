"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useEffect, useRef, useState } from "react";
import {
  Activity,
  AlertTriangle,
  PhoneCall,
  RotateCcw,
  Square,
  Pause as PauseIcon,
} from "lucide-react";
import { label } from "@/lib/domain";
import { money } from "@/lib/format";
import { Badge, GlassCard, StatCard } from "@/components/ui";

type LiveState = {
  status: string;
  providerCampaignId: string | null;
  providerError: string | null;
  totals: {
    contacts: number; attempted: number; inFlight: number; answered: number;
    noAnswer: number; busy: number; failed: number; completed: number;
  };
  outcomes: { outcome: string; count: number }[];
  promises: { count: number; value: number; kept: number; pending: number; broken: number; fulfilmentRate: number };
  redial: Record<string, number>;
  activity: {
    id: string; at: string; phone: string; debtorId: string; debtorName: string;
    status: string; outcome: string | null; promisedAmount: number | null; durationSeconds: number;
  }[];
  batches: { id: string; filter: string; contactCount: number; status: string; createdAt: string; providerError: string | null }[];
  revision: string;
};

const REDIAL_BUTTONS: { filter: string; title: string; icon: typeof RotateCcw }[] = [
  { filter: "no_answer", title: "Redial no answers", icon: RotateCcw },
  { filter: "busy", title: "Retry busy numbers", icon: PhoneCall },
  { filter: "callback_due", title: "Run callbacks due", icon: Activity },
  { filter: "failed", title: "Retry failed calls", icon: AlertTriangle },
];

function maskPhone(phone: string) {
  return phone.length > 6 ? `${phone.slice(0, 6)}•••${phone.slice(-3)}` : phone;
}

function timeOf(iso: string) {
  return new Date(iso).toLocaleTimeString("en-ZA", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function LiveCampaign({
  campaignId,
  initial,
  canControl,
}: {
  campaignId: string;
  initial: LiveState;
  canControl: boolean;
}) {
  const router = useRouter();
  const [state, setState] = useState<LiveState>(initial);
  const [live, setLive] = useState(false);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<{ kind: "ok" | "note" | "error"; text: string } | null>(null);
  const sourceRef = useRef<EventSource | null>(null);

  // Stream state changes instead of refreshing the page.
  useEffect(() => {
    let cancelled = false;
    function connect() {
      if (cancelled) return;
      const source = new EventSource(`/api/campaigns/${campaignId}/live`);
      sourceRef.current = source;
      source.onopen = () => setLive(true);
      source.addEventListener("state", (event) => {
        try {
          setState(JSON.parse((event as MessageEvent).data));
        } catch {
          /* ignore malformed frame */
        }
      });
      source.onerror = () => {
        setLive(false);
        source.close();
        // The stream self-closes on the serverless time limit — reconnect.
        setTimeout(connect, 4000);
      };
    }
    connect();
    return () => {
      cancelled = true;
      sourceRef.current?.close();
    };
  }, [campaignId]);

  async function control(action: "start" | "pause" | "stop") {
    if (action === "stop" && !window.confirm("Stop this campaign? Dialling ends for all remaining contacts.")) return;
    setBusy(action);
    setNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/control`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "The campaign could not be updated.");
      setNotice({
        kind: body.note ? "note" : "ok",
        text: body.note
          ? body.note
          : action === "start"
            ? `${body.contactsQueued} contacts queued via ${body.provider}.${body.manualStep ? ` ${body.manualStep}` : ""}`
            : `Campaign ${body.status}.`,
      });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "The campaign could not be updated." });
    } finally {
      setBusy(null);
    }
  }

  async function redial(filter: string) {
    const count = state.redial[filter] ?? 0;
    if (count === 0) return;
    if (!window.confirm(`Send ${count} contact${count === 1 ? "" : "s"} to the voice platform as a ${label(filter)} redial batch?`)) return;
    setBusy(filter);
    setNotice(null);
    try {
      const res = await fetch(`/api/campaigns/${campaignId}/redial`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ filter }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "The redial batch could not be sent.");
      setNotice({
        kind: "ok",
        text: `Redial batch created with ${body.contactCount} contact${body.contactCount === 1 ? "" : "s"} — only the filtered contacts were sent.${body.manualStep ? ` ${body.manualStep}` : ""}`,
      });
      router.refresh();
    } catch (err) {
      setNotice({ kind: "error", text: err instanceof Error ? err.message : "The redial batch could not be sent." });
    } finally {
      setBusy(null);
    }
  }

  const t = state.totals;
  const isLive = ["running", "active", "queued"].includes(state.status);

  return (
    <div className="space-y-4">
      {/* control bar */}
      <GlassCard>
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div className="flex items-center gap-3">
            <span className="flex items-center gap-2">
              <span
                className={`h-2 w-2 rounded-full ${
                  isLive ? "animate-pulse bg-[#35c06f]" : state.status === "failed" ? "bg-[#e57373]" : "bg-ink-3"
                }`}
              />
              <Badge value={state.status} label={label(state.status)} />
            </span>
            <span className="text-[0.71875rem] text-ink-3">
              {live ? "Live · streaming updates" : "Reconnecting…"}
              {state.providerCampaignId && (
                <span className="num ml-2">· provider ref {state.providerCampaignId.slice(0, 24)}</span>
              )}
            </span>
          </div>
          {canControl && (
            <div className="flex flex-wrap items-center gap-2">
              {/* No Start here. Starting a run means sending the dialling list
                  first, which is step 2 below — a second Start button on this
                  bar could only either duplicate that or skip the list, and
                  skipping it starts a run that dials nobody. */}
              <button className="btn" disabled={busy !== null || !isLive} onClick={() => control("pause")}>
                <PauseIcon size={13} /> Pause
              </button>
              <button className="btn btn-danger" disabled={busy !== null || state.status === "draft"} onClick={() => control("stop")}>
                <Square size={13} /> Stop
              </button>
            </div>
          )}
        </div>

        {state.providerError && (
          <p className="mt-3 rounded-lg border border-[rgba(208,59,59,0.35)] bg-[rgba(208,59,59,0.08)] px-3 py-2 text-[0.78125rem] text-[#ec8181]">
            Integration error: {state.providerError}
          </p>
        )}
        {notice && (
          <p
            className={`mt-3 rounded-lg border px-3 py-2 text-[0.78125rem] ${
              notice.kind === "ok"
                ? "border-[rgba(12,163,12,0.3)] bg-[rgba(12,163,12,0.08)] text-[#5fc46a]"
                : notice.kind === "note"
                  ? // Something the operator has to go and do, not a failure.
                    "border-line bg-white/[0.03] text-ink-2"
                  : "border-[rgba(208,59,59,0.35)] bg-[rgba(208,59,59,0.08)] text-[#ec8181]"
            }`}
          >
            {notice.text}
          </p>
        )}
      </GlassCard>

      {/* live KPIs */}
      <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
        <StatCard label="Total contacts" value={String(t.contacts)} />
        <StatCard label="Calls attempted" value={String(t.attempted)} />
        <StatCard label="Currently calling" value={String(t.inFlight)} tone={t.inFlight > 0 ? "accent" : undefined} />
        <StatCard label="Answered" value={String(t.answered)} tone="good" />
        <StatCard label="No answer" value={String(t.noAnswer)} />
        <StatCard label="Promises to pay" value={String(state.promises.count)} />
        <StatCard label="PTP value" value={money(state.promises.value)} tone="good" sub={`${state.promises.kept} kept · ${state.promises.pending} pending · ${state.promises.broken} broken`} />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        {/* activity feed */}
        <GlassCard className="xl:col-span-2" title="Live activity" subtitle="Most recent call events, newest first">
          {state.activity.length === 0 ? (
            <p className="py-8 text-center text-[0.8125rem] text-ink-3">
              No calls yet. Start the campaign and events will appear here as they happen.
            </p>
          ) : (
            <ul className="divide-y divide-white/[0.05]">
              {state.activity.map((item) => (
                <li key={item.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-2">
                  <span className="num text-[0.71875rem] text-ink-3">{timeOf(item.at)}</span>
                  <Link href={`/debtors/${item.debtorId}`} className="text-[0.8125rem] text-ink hover:text-accent">
                    {item.debtorName}
                  </Link>
                  <span className="num text-[0.71875rem] text-ink-3">{maskPhone(item.phone)}</span>
                  <Badge value={item.outcome ?? item.status} label={label(item.outcome ?? item.status)} />
                  {item.promisedAmount != null && (
                    <span className="num text-[0.78125rem] text-[#5fc46a]">{money(item.promisedAmount)}</span>
                  )}
                  <Link href={`/calls/${item.id}`} className="ml-auto text-[0.6875rem] text-accent hover:underline">
                    open call
                  </Link>
                </li>
              ))}
            </ul>
          )}
        </GlassCard>

        {/* redial actions */}
        <div className="space-y-4">
          <GlassCard title="Redial actions" subtitle="Each button sends only its filtered contacts">
            <ul className="space-y-2.5">
              {REDIAL_BUTTONS.map(({ filter, title, icon: Icon }) => {
                const count = state.redial[filter] ?? 0;
                return (
                  <li key={filter} className="flex items-center justify-between gap-3">
                    <span className="text-[0.78125rem] text-ink-2">
                      {label(filter)}: <span className="num font-medium text-ink">{count}</span>
                    </span>
                    <button
                      className="btn text-[0.71875rem]"
                      disabled={!canControl || count === 0 || busy !== null}
                      onClick={() => redial(filter)}
                      title={canControl ? title : "Your role cannot redial contacts"}
                    >
                      <Icon size={12} />
                      {busy === filter ? "Sending…" : title}
                    </button>
                  </li>
                );
              })}
            </ul>
            <p className="mt-3 text-[0.65625rem] leading-relaxed text-ink-3">
              Contacts at the attempt limit, settled accounts, disputes and opt-outs are excluded
              automatically.
            </p>
          </GlassCard>

          <GlassCard title="Outcome breakdown" subtitle="Connected calls only">
            {state.outcomes.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">No connected calls yet.</p>
            ) : (
              <ul className="space-y-2">
                {state.outcomes.map((o) => (
                  <li key={o.outcome} className="flex items-center justify-between gap-3">
                    <Badge value={o.outcome} label={label(o.outcome)} />
                    <span className="num text-[0.8125rem] font-medium text-ink">{o.count}</span>
                  </li>
                ))}
              </ul>
            )}
          </GlassCard>

          {state.batches.length > 0 && (
            <GlassCard title="Redial batches">
              <ul className="space-y-2">
                {state.batches.map((b) => (
                  <li key={b.id} className="text-[0.78125rem]">
                    <div className="flex items-center justify-between gap-3">
                      <span className="text-ink-2">
                        {label(b.filter)} · <span className="num">{b.contactCount}</span> contacts
                      </span>
                      <Badge value={b.status} label={label(b.status)} />
                    </div>
                    {b.providerError && (
                      <p className="mt-0.5 text-[0.6875rem] text-[#ec8181]">{b.providerError}</p>
                    )}
                  </li>
                ))}
              </ul>
            </GlassCard>
          )}
        </div>
      </div>
    </div>
  );
}
