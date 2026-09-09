"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { RefreshCw } from "lucide-react";

export function RefreshInsightsButton({ scope }: { scope: "dashboard" | "insights" }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function run() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/insights/generate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ scope }),
      });
      if (!res.ok) throw new Error(String(res.status));
      router.refresh();
    } catch {
      setError(true);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex items-center gap-2">
      {error && <span className="text-[0.6875rem] text-critical">Analysis could not be generated</span>}
      <button onClick={run} disabled={busy} className="btn btn-ghost text-[0.75rem]">
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        {busy ? "Analysing…" : "Regenerate"}
      </button>
    </div>
  );
}
