"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { Download, RefreshCw, Share2 } from "lucide-react";

export function ReportActions({ reportId }: { reportId: string }) {
  const router = useRouter();
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);

  async function regenerate() {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(`/api/reports/${reportId}/regenerate`, { method: "POST" });
      if (!res.ok) throw new Error();
      router.refresh();
    } catch {
      setNote("The report could not be regenerated.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {note && <span className="max-w-xs text-[0.6875rem] text-ink-3">{note}</span>}
      <button onClick={regenerate} disabled={busy} className="btn">
        <RefreshCw size={13} className={busy ? "animate-spin" : ""} />
        {busy ? "Regenerating…" : "Regenerate"}
      </button>
      <button onClick={() => window.print()} className="btn btn-ghost" title="Print or save as PDF">
        <Download size={13} /> Export PDF
      </button>
      <button
        onClick={() => {
          setNote("Share links are not yet available. Use Export PDF.");
          setTimeout(() => setNote(null), 3500);
        }}
        className="btn btn-ghost"
      >
        <Share2 size={13} /> Share
      </button>
    </div>
  );
}
