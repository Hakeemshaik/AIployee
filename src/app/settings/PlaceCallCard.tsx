"use client";

import { useState } from "react";
import { AlertTriangle, Loader2, PhoneOutgoing } from "lucide-react";
import { Card } from "@/components/ui";
import { CallResult } from "@/components/CallResult";

// ---------------------------------------------------------------------------
// Place one call.
//
// The whole integration reduced to its smallest working part: a name, a number,
// one write, one call. It is the same mechanism a Speed to Lead submit uses, so
// if this rings and a campaign send does not, the difference is in the send and
// not in the connection — and if this does not ring, nothing else will either.
//
// Nothing is pre-filled. A field that arrives with somebody's real number in it
// is one stray click away from calling them.
// ---------------------------------------------------------------------------

type Result = {
  suid: string;
  attemptId: string;
  name: string;
  phone: string;
  callFlag: string;
  sent: unknown;
  received: unknown;
  build: string;
  nextStep: string;
};

export function PlaceCallCard() {
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<Result | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function place() {
    if (!window.confirm(`Call ${phone} now?\n\nThis dials a real phone the moment it is sent.`)) return;
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const response = await fetch("/api/calling/one", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, phone }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The call could not be placed.");
      setResult(body as Result);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The call could not be placed.");
    } finally {
      setBusy(false);
    }
  }

  const ready = name.trim().length > 1 && /^\+\d{8,15}$/.test(phone.trim().replace(/\s+/g, ""));

  return (
    <Card
      title="Place one call"
      subtitle="One customer written, one call — the same mechanism a form submit uses"
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="mb-1 block text-[0.71875rem] text-ink-2">Name</span>
          <input
            className="field w-full"
            value={name}
            onChange={(event) => setName(event.target.value)}
            placeholder="Who the agent is calling"
            autoComplete="off"
          />
        </label>
        <label className="block">
          <span className="mb-1 block text-[0.71875rem] text-ink-2">Number</span>
          <input
            className="field w-full"
            value={phone}
            onChange={(event) => setPhone(event.target.value)}
            placeholder="+27825551234"
            inputMode="tel"
            autoComplete="off"
          />
        </label>
      </div>

      <button className="btn btn-primary mt-3" onClick={place} disabled={busy || !ready}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <PhoneOutgoing size={13} />}
        {busy ? "Writing the customer…" : "Call this number"}
      </button>
      <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-3">
        Full international form. The record is written with the configured call flag, so the flow dials it
        as it lands — inside calling hours only, and never a number on the deny list.
      </p>

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-serious/35 bg-serious/8 px-3 py-2.5 text-[0.78125rem] leading-relaxed text-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-serious" />
          {error}
        </p>
      )}

      {result && (
        <div className="mt-3">
          {/* The call itself, live: ringing, then answered, then what was said
              and what they committed to. */}
          <CallResult attemptId={result.attemptId} />
          <p className="num mt-2 text-[0.6875rem] text-ink-3">
            {result.build} · reference {result.suid}
          </p>
          <details className="mt-2 text-[0.6875rem] text-ink-3">
            <summary className="cursor-pointer">What was sent, and what came back</summary>
            <pre className="scroll-x mt-1.5 rounded-lg border border-line bg-ink/[0.05] p-2.5 text-[0.625rem] leading-relaxed text-ink-2">
{JSON.stringify({ sent: result.sent, received: result.received }, null, 2)}
            </pre>
          </details>
        </div>
      )}
    </Card>
  );
}
