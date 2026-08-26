"use client";

import { useState } from "react";
import { AlertTriangle, Check, Loader2, RefreshCw, Trash2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Clearing the demo book.
//
// This deletes real rows, so the flow is: fetch a preview of exactly what goes
// and what stays, show both, then require the organization name typed exactly.
// The confirmation is re-checked on the server — the button is a convenience,
// not the guard.
// ---------------------------------------------------------------------------

type Preview = {
  organizationName: string;
  removing: { label: string; count: number }[];
  keeping: { label: string; count: number }[];
  removingUsers: { name: string; email: string; role: string }[];
  revokingKeys: { name: string; keyPrefix: string }[];
  totalRows: number;
};

type Result = {
  organizationName: string;
  totalDeleted: number;
  keysRevoked: number;
  usersRemoved: number;
};

export function ResetDataCard() {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [state, setState] = useState<"idle" | "loading" | "working">("idle");
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const [confirmation, setConfirmation] = useState("");
  const [newName, setNewName] = useState("");
  const [includeIngested, setIncludeIngested] = useState(false);

  async function loadPreview() {
    setState("loading");
    setError(null);
    try {
      const res = await fetch("/api/settings/reset", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "Could not read the current data.");
      setPreview(body as Preview);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not read the current data.");
    } finally {
      setState("idle");
    }
  }

  async function run() {
    setState("working");
    setError(null);
    try {
      const res = await fetch("/api/settings/reset", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          confirmation,
          ...(newName.trim() ? { newOrganizationName: newName.trim() } : {}),
          includeIngestedData: includeIngested,
        }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "The reset did not run.");
      setResult(body as Result);
      setPreview(null);
      setConfirmation("");
    } catch (err) {
      setError(err instanceof Error ? err.message : "The reset did not run.");
    } finally {
      setState("idle");
    }
  }

  if (result) {
    return (
      <section className="glass p-5">
        <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-ink">
          <Check size={15} className="text-[#3ecf9a]" /> Demo data cleared
        </h2>
        <p className="mt-2 text-[0.8125rem] leading-relaxed text-ink-2">
          Removed <span className="num font-medium text-ink">{result.totalDeleted.toLocaleString("en-ZA")}</span>{" "}
          rows, revoked <span className="num font-medium text-ink">{result.keysRevoked}</span> API{" "}
          {result.keysRevoked === 1 ? "key" : "keys"} and removed{" "}
          <span className="num font-medium text-ink">{result.usersRemoved}</span> other user{" "}
          {result.usersRemoved === 1 ? "account" : "accounts"}. You are signed in to{" "}
          <span className="font-medium text-ink">{result.organizationName}</span>.
        </p>
        <p className="mt-3 rounded-lg border border-line bg-white/[0.03] px-3 py-2.5 text-[0.78125rem] leading-relaxed text-ink-2">
          Next: import your book at <span className="text-accent">Debtors → Import</span>, then issue a
          fresh webhook key below and point your voice platform at it. The old key no longer works.
        </p>
      </section>
    );
  }

  return (
    <section className="glass border-[rgba(217,89,38,0.28)] p-5">
      <h2 className="flex items-center gap-2 text-[0.9375rem] font-semibold tracking-tight text-ink">
        <Trash2 size={15} className="text-[#e2714a]" /> Clear demo data
      </h2>
      <p className="mt-1 text-[0.75rem] leading-relaxed text-ink-3">
        Removes the seeded fictional book — debtors, campaigns, calls, promises, payments and the
        demo staff accounts — and revokes every API key. Your sign-in, compliance settings and any
        calls ingested from your voice provider are kept.
      </p>

      {!preview && (
        <button className="btn mt-4" onClick={loadPreview} disabled={state === "loading"}>
          {state === "loading" ? <Loader2 size={13} className="animate-spin" /> : <RefreshCw size={13} />}
          Preview what would be removed
        </button>
      )}

      {error && (
        <p className="mt-3 flex items-start gap-2 rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2.5 text-[0.78125rem] text-[#e2714a]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div className="mt-4 space-y-4">
          <div className="grid gap-4 sm:grid-cols-2">
            <div>
              <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-[#e2714a]">
                Will be deleted
              </p>
              <ul className="space-y-1">
                {preview.removing.map((row) => (
                  <li key={row.label} className="flex justify-between gap-3 text-[0.78125rem] text-ink-2">
                    <span>{row.label}</span>
                    <span className="num text-ink">{row.count.toLocaleString("en-ZA")}</span>
                  </li>
                ))}
                {preview.removing.length === 0 && (
                  <li className="text-[0.78125rem] text-ink-3">Nothing — this book is already empty.</li>
                )}
              </ul>
            </div>
            <div>
              <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-[#3ecf9a]">
                Will be kept
              </p>
              <ul className="space-y-1">
                {preview.keeping.map((row) => (
                  <li key={row.label} className="flex justify-between gap-3 text-[0.78125rem] text-ink-2">
                    <span>{row.label}</span>
                    <span className="num text-ink">{row.count.toLocaleString("en-ZA")}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>

          {preview.removingUsers.length > 0 && (
            <p className="text-[0.71875rem] leading-relaxed text-ink-3">
              Accounts removed: {preview.removingUsers.map((u) => `${u.name} (${u.role})`).join(", ")}.
              Yours is kept.
            </p>
          )}

          {preview.revokingKeys.length > 0 && (
            <p className="flex items-start gap-2 rounded-lg border border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)] px-3 py-2.5 text-[0.71875rem] leading-relaxed text-[#f2c14e]">
              <AlertTriangle size={13} className="mt-0.5 shrink-0" />
              Revoking {preview.revokingKeys.length} API{" "}
              {preview.revokingKeys.length === 1 ? "key" : "keys"} — anything currently posting to the
              webhook will stop working until you issue a new one. The seeded key is not a secret and
              must not stay live.
            </p>
          )}

          <div className="grid gap-3 border-t border-line-2 pt-4 sm:grid-cols-2">
            <div>
              <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="newName">
                Rename organization <span className="font-normal text-ink-3">(optional)</span>
              </label>
              <input
                id="newName"
                value={newName}
                onChange={(e) => setNewName(e.target.value)}
                className="field w-full"
              />
              <p className="mt-1 text-[0.6875rem] text-ink-3">
                Currently {preview.organizationName} — the seeded name.
              </p>
            </div>
            <div>
              <label className="mb-1 block text-[0.71875rem] font-medium text-ink-2" htmlFor="confirm">
                Type <span className="font-semibold text-ink">{preview.organizationName}</span> to confirm
              </label>
              <input
                id="confirm"
                value={confirmation}
                onChange={(e) => setConfirmation(e.target.value)}
                autoComplete="off"
                className="field w-full"
              />
            </div>
          </div>

          <label className="flex items-start gap-2 text-[0.71875rem] leading-relaxed text-ink-2">
            <input
              type="checkbox"
              checked={includeIngested}
              onChange={(e) => setIncludeIngested(e.target.checked)}
              className="mt-0.5 h-3.5 w-3.5 accent-[#3987e5]"
            />
            Also delete calls and transcripts ingested from the voice provider. Leave this off unless
            you want to re-ingest from scratch — this data is not part of the demo seed.
          </label>

          <div className="flex items-center gap-2">
            <button
              className="btn btn-danger"
              disabled={state === "working" || confirmation.trim() !== preview.organizationName}
              title={
                confirmation.trim() !== preview.organizationName
                  ? "Type the organization name exactly to enable this"
                  : "Delete the demo book"
              }
              onClick={run}
            >
              {state === "working" ? <Loader2 size={13} className="animate-spin" /> : <Trash2 size={13} />}
              {state === "working" ? "Clearing…" : `Delete ${preview.totalRows.toLocaleString("en-ZA")} rows`}
            </button>
            <button className="btn btn-ghost" onClick={() => setPreview(null)} disabled={state === "working"}>
              Cancel
            </button>
          </div>
        </div>
      )}
    </section>
  );
}
