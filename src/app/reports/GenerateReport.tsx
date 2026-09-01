"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { label, REPORT_TYPES } from "@/lib/domain";

export function GenerateReportControl({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const [type, setType] = useState<string>("daily");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState(false);

  async function generate() {
    setBusy(true);
    setError(false);
    try {
      const res = await fetch("/api/reports", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ type, ...(type === "campaign" && campaignId ? { campaignId } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error();
      router.push(`/reports/${body.id}`);
      router.refresh();
    } catch {
      setError(true);
      setBusy(false);
    }
  }

  return (
    <div className="flex flex-wrap items-center gap-2">
      {error && <span className="text-[0.6875rem] text-critical">The report could not be generated.</span>}
      <select className="field" value={type} onChange={(e) => setType(e.target.value)} aria-label="Report type">
        {REPORT_TYPES.map((t) => (
          <option key={t} value={t}>{label(t)}</option>
        ))}
      </select>
      {type === "campaign" && (
        <select className="field" value={campaignId} onChange={(e) => setCampaignId(e.target.value)} aria-label="Campaign">
          <option value="">All campaigns</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>{c.name}</option>
          ))}
        </select>
      )}
      <button onClick={generate} disabled={busy} className="btn btn-primary">
        <FilePlus2 size={14} />
        {busy ? "Generating…" : "Generate report"}
      </button>
    </div>
  );
}
