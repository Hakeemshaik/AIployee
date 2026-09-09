"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { useConfirm } from "@/components/Dialog";

export function CancelPromiseButton({ promiseId }: { promiseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const confirm = useConfirm();

  async function cancel() {
    const ok = await confirm({
      title: "Cancel this promise?",
      body: "The arrangement is dropped and the account returns to normal follow-up, so it becomes eligible to be dialled again.",
      confirmLabel: "Cancel the promise",
      cancelLabel: "Keep it",
      kind: "danger",
    });
    if (!ok) return;
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/promises/${promiseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError("Could not cancel the promise — it may already be resolved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <span className="inline-flex items-center gap-2">
      {error && <span className="text-[0.6875rem] text-critical">{error}</span>}
      <button onClick={cancel} disabled={busy} className="btn btn-ghost text-[0.71875rem] text-ink-3">
        {busy ? "Cancelling…" : "Cancel"}
      </button>
    </span>
  );
}

export function SweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function sweep() {
    setBusy(true);
    setResult(null);
    setError(null);
    try {
      const res = await fetch("/api/promises/sweep", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error();
      setResult(body.marked);
      router.refresh();
    } catch {
      setError("The sweep could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[0.71875rem] text-critical">{error}</span>}
      {result != null && (
        <span className="text-[0.71875rem] text-ink-3">
          {result === 0 ? "No promises are past the grace period" : `${result} marked broken`}
        </span>
      )}
      <button onClick={sweep} disabled={busy} className="btn">
        {busy ? "Sweeping…" : "Mark overdue as broken"}
      </button>
    </div>
  );
}
