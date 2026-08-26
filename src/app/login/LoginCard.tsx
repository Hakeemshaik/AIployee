"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState } from "react";
import { ArrowRight, Eye, KeyRound, PlayCircle, ShieldAlert } from "lucide-react";

// ---------------------------------------------------------------------------
// Sign in.
//
// Three ways in, and the card only offers the ones that apply:
//
//  * Continue as guest — a read-only demo session over fixture data.
//  * Sign in — email and password. Both fields start empty, with autofill off
//    and no placeholder text: nothing on this page is pre-filled or suggested.
//  * Claim — shown only while the deployment has users but no password at all
//    (a seeded database). It sets the first password and closes for good.
//
// Nothing account-specific is rendered here. The page is reachable without a
// session, so naming a user or the organization would disclose both to anyone
// who loaded it.
// ---------------------------------------------------------------------------

/**
 * Move to a signed-in page after the session cookie is set.
 *
 * The refresh matters: starting a session changes the ROOT layout (the shell
 * and its navigation appear), and a push alone re-renders only the page, so the
 * app would land on /analytics with no navigation and no way to sign out.
 */
function enter(router: { push: (href: string) => void; refresh: () => void }, to: string) {
  router.push(to);
  router.refresh();
}

type SessionInfo = { unclaimed: boolean };

export function LoginCard() {
  const router = useRouter();
  const [busy, setBusy] = useState<"guest" | "signin" | "claim" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [info, setInfo] = useState<SessionInfo | null>(null);
  const [mode, setMode] = useState<"signin" | "claim">("signin");

  useEffect(() => {
    let cancelled = false;
    fetch("/api/session", { cache: "no-store" })
      .then((r) => r.json())
      .then((body: SessionInfo) => {
        if (cancelled) return;
        setInfo(body);
        if (body.unclaimed) setMode("claim");
      })
      .catch(() => {
        /* the card still works without this hint */
      });
    return () => {
      cancelled = true;
    };
  }, []);

  async function post(body: Record<string, unknown>): Promise<string> {
    const res = await fetch("/api/session", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const parsed = (await res.json().catch(() => ({}))) as { message?: string; redirectTo?: string };
    if (!res.ok) throw new Error(parsed.message ?? "Sign-in failed. Check your email and password.");
    return parsed.redirectTo ?? "/";
  }

  async function continueAsGuest() {
    setBusy("guest");
    setError(null);
    try {
      const to = await post({ mode: "guest" });
      enter(router, to);
    } catch {
      setError("Could not start the demo session.");
      setBusy(null);
    }
  }

  async function submitCredentials(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    const name = String(form.get("name") ?? "").trim();
    if (!email || !password) {
      setError("Enter your email and password.");
      return;
    }
    setBusy(mode);
    setError(null);
    try {
      const to = await post({ mode, email, password, ...(name ? { name } : {}) });
      enter(router, to);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sign-in failed. Try again.");
      setBusy(null);
    }
  }

  const claiming = mode === "claim";

  return (
    <div className="glass w-full max-w-md p-6">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#3f8de9] to-[#2d6fc4] text-[17px] font-bold text-white shadow-[0_0_22px_rgba(57,135,229,0.35)]">
          A
        </span>
        <h1 className="text-[1.0625rem] font-semibold tracking-tight text-ink">AIployee Command Centre</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-2">AI voice collections, analysed end-to-end.</p>
      </div>

      {info?.unclaimed && (
        <div className="mb-5 rounded-xl border border-[rgba(250,178,25,0.32)] bg-[rgba(250,178,25,0.08)] p-3.5">
          <p className="flex items-start gap-2 text-[0.8125rem] font-medium text-[#f2c14e]">
            <ShieldAlert size={14} className="mt-0.5 shrink-0" />
            No password is set on this deployment
          </p>
          <p className="mt-1 pl-[1.375rem] text-[0.75rem] leading-relaxed text-ink-2">
            Set one now with your own email and password. Until you do, the same offer is open to
            anyone who finds this URL.
          </p>
        </div>
      )}

      <button onClick={continueAsGuest} disabled={busy !== null} className="btn btn-primary w-full justify-center">
        <PlayCircle size={15} />
        {busy === "guest" ? "Opening demo…" : "Continue as guest"}
      </button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-[0.6875rem] text-ink-3">
        <Eye size={11} /> Read-only demo data · no live accounts · calling disabled
      </p>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-3">
          {claiming ? "or set your password" : "or sign in"}
        </span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={submitCredentials} className="space-y-3">
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="email">
            Email
          </label>
          <input id="email" name="email" type="email" autoComplete="off" className="field w-full" />
        </div>
        {claiming && (
          <div>
            <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="name">
              Your name <span className="font-normal text-ink-3">(optional)</span>
            </label>
            <input id="name" name="name" autoComplete="off" className="field w-full" />
          </div>
        )}
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="password">
            {claiming ? "Choose a password" : "Password"}
          </label>
          <input
            id="password"
            name="password"
            type="password"
            autoComplete={claiming ? "new-password" : "off"}
            minLength={claiming ? 12 : undefined}
            className="field w-full"
          />
          {claiming && (
            <p className="mt-1 text-[0.6875rem] text-ink-3">At least 12 characters.</p>
          )}
        </div>
        {error && <p className="text-[0.75rem] text-[#ec8181]">{error}</p>}
        <button type="submit" disabled={busy !== null} className="btn w-full justify-center">
          {busy === "signin" || busy === "claim" ? (
            claiming ? "Securing…" : "Signing in…"
          ) : claiming ? (
            <>
              <KeyRound size={13} /> Set password and sign in
            </>
          ) : (
            <>
              Sign in <ArrowRight size={13} />
            </>
          )}
        </button>
      </form>

      {info?.unclaimed && (
        <button
          type="button"
          onClick={() => setMode(claiming ? "signin" : "claim")}
          className="mt-3 w-full text-center text-[0.71875rem] text-ink-3 hover:text-ink-2"
        >
          {claiming ? "I already have a password" : "Set the first password instead"}
        </button>
      )}
    </div>
  );
}
