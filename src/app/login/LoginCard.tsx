"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { ArrowRight, Eye, PlayCircle } from "lucide-react";

export function LoginCard() {
  const router = useRouter();
  const [busy, setBusy] = useState<"guest" | "signin" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function continueAsGuest() {
    setBusy("guest");
    setError(null);
    try {
      const res = await fetch("/api/session", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ mode: "guest" }),
      });
      if (!res.ok) throw new Error();
      router.push("/analytics");
    } catch {
      setError("Could not start the demo session.");
      setBusy(null);
    }
  }

  async function signIn(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy("signin");
    setError(null);
    const form = new FormData(e.currentTarget);
    const email = String(form.get("email") ?? "").trim();
    const password = String(form.get("password") ?? "");
    if (!email || !password) {
      setError("Enter your email and password.");
      setBusy(null);
      return;
    }
    // Real authentication is not wired up yet — see src/lib/auth.ts. Nothing is
    // accepted here rather than silently signing anyone in.
    setError("Sign-in is not enabled on this deployment yet. Use the demo, or contact your administrator.");
    setBusy(null);
  }

  return (
    <div className="glass w-full max-w-md p-6">
      <div className="mb-6 text-center">
        <span className="mx-auto mb-3 flex h-11 w-11 items-center justify-center rounded-[13px] bg-gradient-to-b from-[#3f8de9] to-[#2d6fc4] text-[17px] font-bold text-white shadow-[0_0_22px_rgba(57,135,229,0.35)]">
          A
        </span>
        <h1 className="text-[1.0625rem] font-semibold tracking-tight text-ink">AIployee Command Centre</h1>
        <p className="mt-1 text-[0.8125rem] text-ink-2">AI voice collections, analysed end-to-end.</p>
      </div>

      <button onClick={continueAsGuest} disabled={busy !== null} className="btn btn-primary w-full justify-center">
        <PlayCircle size={15} />
        {busy === "guest" ? "Opening demo…" : "Continue as guest"}
      </button>
      <p className="mt-2 flex items-center justify-center gap-1.5 text-[0.6875rem] text-ink-3">
        <Eye size={11} /> Read-only demo data · no live accounts · calling disabled
      </p>

      <div className="my-5 flex items-center gap-3">
        <span className="h-px flex-1 bg-line" />
        <span className="text-[0.6875rem] uppercase tracking-[0.08em] text-ink-3">or sign in</span>
        <span className="h-px flex-1 bg-line" />
      </div>

      <form onSubmit={signIn} className="space-y-3">
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="email">Email</label>
          <input id="email" name="email" type="email" autoComplete="off" className="field w-full" />
        </div>
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="password">Password</label>
          <input id="password" name="password" type="password" autoComplete="off" className="field w-full" />
        </div>
        {error && <p className="text-[0.75rem] text-[#ec8181]">{error}</p>}
        <button type="submit" disabled={busy !== null} className="btn w-full justify-center">
          Sign in <ArrowRight size={13} />
        </button>
      </form>
    </div>
  );
}
