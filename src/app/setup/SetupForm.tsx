"use client";

import Link from "next/link";
import { useState } from "react";
import { Check, Copy, Rocket, Sparkles } from "lucide-react";

type Result = {
  mode: "clean" | "demo";
  orgName: string;
  apiKey: string;
  demoKey?: string;
};

export function SetupForm() {
  const [mode, setMode] = useState<"demo" | "clean">("demo");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [copied, setCopied] = useState(false);

  async function submit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    setBusy(true);
    setError(null);
    const form = new FormData(e.currentTarget);
    try {
      const res = await fetch("/api/setup", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode,
          adminEmail: form.get("adminEmail") || undefined,
          adminPassword: form.get("adminPassword") ?? "",
          ...(mode === "clean"
            ? {
                orgName: form.get("orgName") || undefined,
                adminName: form.get("adminName") || undefined,
              }
            : {}),
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? body.error ?? "Setup failed");
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Setup failed");
    } finally {
      setBusy(false);
    }
  }

  if (result) {
    const webhookUrl = `${typeof window !== "undefined" ? window.location.origin : ""}/api/integrations/voice/call-completed`;
    return (
      <div className="space-y-4">
        <div className="flex items-center gap-3 rounded-lg border border-[rgba(12,163,12,0.3)] bg-[rgba(12,163,12,0.08)] p-4">
          <Check size={18} className="shrink-0 text-[#5fc46a]" />
          <p className="text-[0.875rem] text-ink">
            <span className="font-semibold">{result.orgName}</span> is set up
            {result.mode === "demo" ? " with the demo dataset loaded" : ""}.
          </p>
        </div>

        <div>
          <p className="mb-1.5 text-[0.71875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
            Your Jobix webhook key — shown only once, copy it now
          </p>
          <div className="flex items-center gap-2">
            <code className="num flex-1 truncate rounded-lg border border-line bg-black/30 px-3 py-2.5 text-[0.78125rem] text-ink">
              {result.apiKey}
            </code>
            <button
              className="btn shrink-0"
              onClick={() => {
                navigator.clipboard.writeText(result.apiKey).then(() => {
                  setCopied(true);
                  setTimeout(() => setCopied(false), 1500);
                });
              }}
            >
              {copied ? <Check size={13} /> : <Copy size={13} />}
              {copied ? "Copied" : "Copy"}
            </button>
          </div>
        </div>

        <div>
          <p className="mb-1.5 text-[0.71875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
            Configure Jobix to send completed calls to
          </p>
          <code className="num block truncate rounded-lg border border-line bg-black/30 px-3 py-2.5 text-[0.71875rem] text-ink-2">
            POST {webhookUrl}
          </code>
          <p className="mt-1.5 text-[0.71875rem] text-ink-3">
            Header: <code>Authorization: Bearer &lt;the key above&gt;</code> — full payload reference
            under Settings → Voice platform integration.
          </p>
        </div>

        <Link href="/" className="btn btn-primary inline-flex">
          <Rocket size={14} /> Open the dashboard
        </Link>
      </div>
    );
  }

  return (
    <form onSubmit={submit} className="space-y-5">
      <div className="grid gap-2.5 sm:grid-cols-2">
        <button
          type="button"
          onClick={() => setMode("demo")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            mode === "demo"
              ? "border-[rgba(57,135,229,0.5)] bg-accent-soft"
              : "border-line bg-white/[0.02] hover:bg-white/[0.04]"
          }`}
        >
          <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink">
            <Sparkles size={15} className="text-accent" /> Load the demo dataset
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-2">
            47 fictional debtors, campaigns, calls with transcripts, promises and payments — see the
            whole platform working immediately. Replace with your real book later.
          </p>
        </button>
        <button
          type="button"
          onClick={() => setMode("clean")}
          className={`rounded-xl border p-4 text-left transition-colors ${
            mode === "clean"
              ? "border-[rgba(57,135,229,0.5)] bg-accent-soft"
              : "border-line bg-white/[0.02] hover:bg-white/[0.04]"
          }`}
        >
          <p className="flex items-center gap-2 text-[0.875rem] font-semibold text-ink">
            <Rocket size={15} className="text-accent" /> Start clean
          </p>
          <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-2">
            Empty platform ready for your real book — import debtors via CSV and point Jobix at the
            webhook.
          </p>
        </button>
      </div>

      {mode === "clean" && (
        <div className="grid gap-3 sm:grid-cols-2">
          <div>
            <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="orgName">Organization name</label>
            <input id="orgName" name="orgName" className="field w-full" placeholder="Your company name" />
          </div>
          <div>
            <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="adminName">Your name</label>
            <input id="adminName" name="adminName" className="field w-full" placeholder="Hakeem Shaik" />
          </div>
        </div>
      )}

      {/* Admin sign-in. Set here so the deployment is never left open. */}
      <div className="grid gap-3 sm:grid-cols-2">
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="adminEmail">
            Your email
          </label>
          <input
            id="adminEmail"
            name="adminEmail"
            type="email"
            required
            autoComplete="username"
            className="field w-full"
            placeholder="you@company.co.za"
          />
        </div>
        <div>
          <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="adminPassword">
            Password
          </label>
          <input
            id="adminPassword"
            name="adminPassword"
            type="password"
            required
            minLength={12}
            autoComplete="new-password"
            className="field w-full"
          />
          <p className="mt-1 text-[0.6875rem] text-ink-3">
            At least 12 characters. This is how you sign in — without it the deployment would be
            open to anyone with the URL.
          </p>
        </div>
      </div>

      {error && <p className="text-[0.78125rem] text-[#ec8181]">{error}</p>}
      <button type="submit" disabled={busy} className="btn btn-primary">
        {busy ? "Setting up…" : mode === "demo" ? "Set up with demo data" : "Set up clean"}
      </button>
      <p className="text-[0.6875rem] leading-relaxed text-ink-3">
        This page only works once — after setup it locks itself and every setup request is refused.
      </p>
    </form>
  );
}
