"use client";

import { useState } from "react";
import { AlertTriangle, CheckCircle2, Circle, Loader2, MinusCircle, Plug } from "lucide-react";
import { GlassCard } from "@/components/ui";
import type { ConnectionStatus, VarState } from "@/services/connection-status";

// ---------------------------------------------------------------------------
// Voice platform connection.
//
// Answers one question that presence checks cannot: are the credentials on
// this deployment, and do they work? A variable can be set in the hosting
// dashboard and still be invisible here — saved for a different environment,
// pasted without its value, or added after this deployment was built. Each of
// those looks identical from a screenshot, so each is named separately.
// ---------------------------------------------------------------------------

type TestResult = { ok: boolean; message: string; agents: string[] };

const STATE_STYLE: Record<VarState, { label: string; className: string; Icon: typeof CheckCircle2 }> = {
  set: { label: "Set", className: "text-[#3ecf9a]", Icon: CheckCircle2 },
  empty: { label: "Blank", className: "text-[#f2c14e]", Icon: MinusCircle },
  missing: { label: "Not set", className: "text-ink-3", Icon: Circle },
};

export function ConnectionCard({ status }: { status: ConnectionStatus }) {
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/settings/connection", { method: "POST" });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        setResult({ ok: false, message: body.message ?? "The test could not be run.", agents: [] });
        return;
      }
      setResult(body as TestResult);
    } catch {
      setResult({ ok: false, message: "The test request could not be sent.", agents: [] });
    } finally {
      setBusy(false);
    }
  }

  return (
    <GlassCard
      title="Voice platform connection"
      subtitle="What this deployment can see, and whether the sign-in works"
      actions={
        <button className="btn btn-primary" disabled={busy || !status.canTest} onClick={test}>
          {busy ? <Loader2 size={13} className="animate-spin" /> : <Plug size={13} />}
          Test connection
        </button>
      }
    >
      <p className="mb-3 text-[0.78125rem] leading-relaxed text-ink-2">{status.summary}</p>

      <dl className="mb-4 space-y-1.5">
        {status.vars.map((entry) => {
          const style = STATE_STYLE[entry.state];
          return (
            <div key={entry.name} className="flex items-baseline gap-3" title={entry.purpose}>
              <style.Icon size={13} className={`shrink-0 translate-y-0.5 ${style.className}`} />
              <dt className="num min-w-0 flex-1 truncate text-[0.71875rem] text-ink-2">{entry.name}</dt>
              <dd className={`text-[0.71875rem] ${style.className}`}>
                {style.label}
                {entry.required && entry.state !== "set" ? " · required" : ""}
              </dd>
            </div>
          );
        })}
      </dl>

      {result && (
        <div
          className={`mb-3 rounded-lg border px-3 py-2.5 ${
            result.ok
              ? "border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.08)]"
              : "border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)]"
          }`}
        >
          <p
            className={`flex items-start gap-2 text-[0.78125rem] font-medium ${
              result.ok ? "text-[#3ecf9a]" : "text-[#e2714a]"
            }`}
          >
            {result.ok ? (
              <CheckCircle2 size={13} className="mt-0.5 shrink-0" />
            ) : (
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            )}
            {result.ok ? "Signed in successfully" : "The sign-in failed"}
          </p>
          <p className="mt-1 pl-[1.3rem] text-[0.71875rem] leading-relaxed text-ink-2">{result.message}</p>
          {result.agents.length > 0 && (
            <p className="mt-1 pl-[1.3rem] text-[0.6875rem] leading-relaxed text-ink-3">
              Check these are your agents — every read is scoped to whichever workspace this sign-in
              belongs to: {result.agents.join(", ")}.
            </p>
          )}
        </div>
      )}

      <p className="border-t border-line-2 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
        A deployment only sees the variables that existed when it was built, and each hosting
        environment keeps its own set. If a variable reads Not set here but exists in the dashboard,
        it was added to a different environment, or added after this build — redeploy.
      </p>

      <p className="num mt-2 text-[0.65625rem] text-ink-3">
        Running: env {status.environment ?? "local"}
        {status.branch ? ` · branch ${status.branch}` : ""}
        {status.commit ? ` · build ${status.commit}` : ""}
      </p>
    </GlassCard>
  );
}
