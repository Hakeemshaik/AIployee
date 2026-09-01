"use client";

import { useRouter } from "next/navigation";
import { useState } from "react";
import { FilePlus2 } from "lucide-react";
import { Select } from "@/components/Select";
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
      <Select
        value={type}
        onChange={setType}
        aria-label="Report type"
        options={REPORT_TYPES.map((t) => ({ value: t, label: label(t) }))}
      />
      {type === "campaign" && (
        <Select
          value={campaignId}
          onChange={setCampaignId}
          aria-label="Campaign"
          options={[
            { value: "", label: "All campaigns" },
            ...campaigns.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      )}
      <button onClick={generate} disabled={busy} className="btn btn-primary">
        <FilePlus2 size={14} />
        {busy ? "Generating…" : "Generate report"}
      </button>
    </div>
  );
}
