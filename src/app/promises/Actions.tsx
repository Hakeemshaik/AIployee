"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";

export function CancelPromiseButton({ promiseId }: { promiseId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);

  async function cancel() {
    if (!window.confirm("Cancel this promise? The debtor returns to normal follow-up.")) return;
    setBusy(true);
    try {
      const res = await fetch(`/api/promises/${promiseId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "cancel" }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      window.alert("Could not cancel the promise — it may already be resolved.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <button onClick={cancel} disabled={busy} className="btn btn-ghost text-[0.71875rem] text-ink-3">
      {busy ? "Cancelling…" : "Cancel"}
    </button>
  );
}

export function SweepButton() {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<number | null>(null);

  async function sweep() {
    setBusy(true);
    setResult(null);
    try {
      const res = await fetch("/api/promises/sweep", { method: "POST" });
      const body = await res.json();
      if (!res.ok) throw new Error();
      setResult(body.marked);
      router.refresh();
    } catch {
      window.alert("Sweep failed — try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {result != null && (
        <span className="text-[0.71875rem] text-ink-3">
          {result === 0 ? "Nothing past grace period" : `${result} marked broken`}
        </span>
      )}
      <button onClick={sweep} disabled={busy} className="btn">
        {busy ? "Sweeping…" : "Mark overdue as broken"}
      </button>
    </div>
  );
}
