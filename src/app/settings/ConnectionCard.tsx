"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import {
  AlertTriangle,
  CheckCircle2,
  Circle,
  KeyRound,
  Loader2,
  LogIn,
  MinusCircle,
  Plug,
  Trash2,
} from "lucide-react";
import { GlassCard } from "@/components/ui";
import { formatDateTime } from "@/lib/format";
import type { ConnectionStatus, VarState } from "@/services/connection-status";
import type { SignInStatus } from "@/services/jobix/credentials";

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

export function ConnectionCard({
  status,
  signIn: initialSignIn,
}: {
  status: ConnectionStatus;
  signIn: SignInStatus;
}) {
  const router = useRouter();
  const [result, setResult] = useState<TestResult | null>(null);
  const [busy, setBusy] = useState(false);
  const [signIn, setSignIn] = useState(initialSignIn);
  const [email, setEmail] = useState(initialSignIn.email ?? "");
  const [password, setPassword] = useState("");
  const [saving, setSaving] = useState<"save" | "clear" | null>(null);
  const [signInError, setSignInError] = useState<string | null>(null);

  async function send(body: unknown, kind: "save" | "clear") {
    setSaving(kind);
    setSignInError(null);
    setResult(null);
    try {
      const response = await fetch("/api/settings/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(payload.message ?? "That did not work.");
      setSignIn(payload as SignInStatus);
      setPassword("");
      router.refresh();
    } catch (err) {
      setSignInError(err instanceof Error ? err.message : "That did not work.");
    } finally {
      setSaving(null);
    }
  }

  async function test() {
    setBusy(true);
    setResult(null);
    try {
      const response = await fetch("/api/settings/connection", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: "{}",
      });
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

      {status.envEmail && (
        <p className="mb-3 text-[0.71875rem] leading-relaxed text-ink-3">
          The environment&apos;s sign-in email, exactly as this server reads it:{" "}
          <span className="num text-ink">{status.envEmail}</span>
        </p>
      )}
      {status.envEmailProblem && (
        <p className="mb-3 flex items-start gap-2 rounded-lg border border-[rgba(242,193,78,0.35)] bg-[rgba(242,193,78,0.08)] px-3 py-2 text-[0.78125rem] text-ink">
          <AlertTriangle size={13} className="mt-0.5 shrink-0 text-[#f2c14e]" />
          {status.envEmailProblem}
        </p>
      )}

      <dl className="mb-4 space-y-1.5">
        {status.vars.map((entry) => {
          const style = STATE_STYLE[entry.state];
          return (
            <div key={entry.name} className="flex items-baseline gap-3" title={entry.purpose}>
              <style.Icon size={13} className={`shrink-0 translate-y-0.5 ${style.className}`} />
              <dt className="num min-w-0 flex-1 truncate text-[0.71875rem] text-ink-2">{entry.name}</dt>
              <dd className={`text-[0.71875rem] ${style.className}`}>
                {style.label}
                {/* The sign-in variables stop being required the moment a
                    sign-in is stored here — calling them required would send
                    someone to fix a variable nothing reads. */}
                {entry.required && entry.state !== "set" && !signIn.stored ? " · required" : ""}
                {entry.required && entry.state !== "set" && signIn.stored ? " · not needed" : ""}
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

      {/* Signing in here rather than through an environment variable.
          The dashboard API only accepts tokens minted by a login, and those
          last an hour, so the platform has to be able to log in again on its
          own. When the only source of that credential is an environment
          variable, every way one can go wrong silently stops dialling. */}
      <div className="border-t border-line-2 pt-3">
        <p className="mb-1 flex items-center gap-2 text-[0.78125rem] font-medium text-ink">
          <KeyRound size={13} className="text-accent" /> Sign in to Jobix
        </p>
        {signIn.stored ? (
          <>
            <p className="mb-2.5 flex items-start gap-2 text-[0.75rem] leading-relaxed text-ink-2">
              <CheckCircle2 size={13} className="mt-0.5 shrink-0 text-[#3ecf9a]" />
              {/* One text child. With the email as a second flex item the line
                  broke into columns instead of wrapping as a sentence. */}
              <span>
                Signed in as <span className="num text-ink">{signIn.email}</span>, saved here
                {signIn.savedAt ? ` on ${formatDateTime(signIn.savedAt)}` : ""}. The platform keeps
                itself signed in from this, so no environment variable is involved and no redeploy
                is needed.
              </span>
            </p>
            <div className="flex flex-wrap items-center gap-2">
              <button
                className="btn"
                disabled={saving !== null}
                onClick={() => send({ action: "clear_sign_in" }, "clear")}
                title="Remove the stored sign-in and fall back to the environment"
              >
                {saving === "clear" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
                Remove
              </button>
              <span className="text-[0.6875rem] text-ink-3">
                {signIn.environment
                  ? "The environment also holds a sign-in, which would be used instead."
                  : "There is no sign-in in the environment, so removing this leaves none."}
              </span>
            </div>
          </>
        ) : (
          <>
            <p className="mb-2.5 text-[0.75rem] leading-relaxed text-ink-2">
              {signIn.environment
                ? "The platform is using the sign-in from the environment. Signing in here instead stores it on the platform, so a wrong or blank variable can no longer stop dialling."
                : "No sign-in is available. Enter the Jobix dashboard sign-in and the platform will keep itself signed in from it."}
            </p>
            <div className="flex flex-wrap items-end gap-2">
              <label className="block">
                <span className="mb-1 block text-[0.6875rem] text-ink-3">Email</span>
                <input
                  className="field num w-[230px]"
                  type="email"
                  autoComplete="off"
                  value={email}
                  onChange={(event) => setEmail(event.target.value)}
                />
              </label>
              <label className="block">
                <span className="mb-1 block text-[0.6875rem] text-ink-3">Password</span>
                <input
                  className="field w-[190px]"
                  type="password"
                  autoComplete="new-password"
                  value={password}
                  onChange={(event) => setPassword(event.target.value)}
                />
              </label>
              <button
                className="btn btn-primary"
                disabled={saving !== null || !email.trim() || !password}
                onClick={() => send({ action: "sign_in", email, password }, "save")}
              >
                {saving === "save" ? <Loader2 size={13} className="animate-spin" /> : <LogIn size={13} />}
                Sign in and save
              </button>
            </div>
            <p className="mt-1.5 text-[0.65625rem] leading-relaxed text-ink-3">
              Checked against Jobix before it is stored, so saving it proves it works. Encrypted at
              rest and never sent back to this page.
            </p>
          </>
        )}
        {signInError && (
          <p className="mt-2 flex items-start gap-2 rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2 text-[0.78125rem] text-[#e2714a]">
            <AlertTriangle size={13} className="mt-0.5 shrink-0" />
            {signInError}
          </p>
        )}
      </div>

      <p className="mt-3 border-t border-line-2 pt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
        A deployment only sees the variables that existed when it was built, and each hosting
        environment keeps its own set. If a variable reads Not set here but exists in the dashboard,
        it was added to a different environment, or added after this build — redeploy. Signing in
        above avoids that for the sign-in itself.
      </p>

      <p className="num mt-2 text-[0.65625rem] text-ink-3">
        Running: env {status.environment ?? "local"}
        {status.branch ? ` · branch ${status.branch}` : ""}
        {status.commit ? ` · build ${status.commit}` : ""}
      </p>
    </GlassCard>
  );
}
