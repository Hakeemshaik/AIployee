"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";
import { Check, Copy, KeyRound, Loader2 } from "lucide-react";

// ---------------------------------------------------------------------------
// Minting the webhook key, from the screen that tells you to configure the
// webhook. The key is shown once, with a copy button, and then it is a hash in
// the database like every other key — so the panel says that plainly instead
// of letting anybody believe they can come back for it.
// ---------------------------------------------------------------------------

export function CreateKeyButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [minted, setMinted] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function mint() {
    setBusy(true);
    setError(null);
    try {
      const response = await fetch("/api/settings/api-keys", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name: "Jobix webhook" }),
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(
          body.error === "demo_mode"
            ? "Keys cannot be created in the demo."
            : "Only an admin can create a key.",
        );
      }
      setMinted(body.key as string);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The key could not be created.");
    } finally {
      setBusy(false);
    }
  }

  async function copy() {
    if (!minted) return;
    try {
      await navigator.clipboard.writeText(minted);
      setCopied(true);
      setTimeout(() => setCopied(false), 1600);
    } catch {
      // The key is on screen; selecting it by hand still works.
    }
  }

  if (minted) {
    return (
      <div className="mt-3 rounded-xl border border-good/35 bg-good/[0.07] p-3">
        <p className="text-[0.75rem] font-medium text-ink">
          Your webhook key — copy it now, it is shown once and never again:
        </p>
        <div className="mt-2 flex items-center gap-2">
          <code className="num min-w-0 flex-1 truncate rounded-lg border border-line bg-white/80 px-2.5 py-1.5 text-[0.71875rem] text-ink">
            {minted}
          </code>
          <button className="btn btn-sm shrink-0" onClick={copy}>
            {copied ? <Check size={12} className="text-good" /> : <Copy size={12} />}
            {copied ? "Copied" : "Copy"}
          </button>
        </div>
        <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-2">
          Paste it into the Jobix webhook node as{" "}
          <code className="rounded bg-ink/[0.06] px-1">Authorization: Bearer &lt;key&gt;</code>.
          Only its hash is stored here, so if it is lost, create a new one.
        </p>
      </div>
    );
  }

  return (
    <div className="mt-3">
      <button className="btn" onClick={mint} disabled={busy}>
        {busy ? <Loader2 size={13} className="animate-spin" /> : <KeyRound size={13} />}
        {busy ? "Creating…" : "Create a webhook key"}
      </button>
      {error && <p className="mt-2 text-[0.71875rem] text-critical">{error}</p>}
    </div>
  );
}
