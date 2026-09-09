"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useRef, useState } from "react";
import { CheckCircle2, FileUp, Upload } from "lucide-react";
import { Select } from "@/components/Select";

const TEMPLATE = `firstName,lastName,accountNumber,phone,email,city,province,creditorName,originalBalance,currentBalance,dueDate
Jane,Doe,ACC-1001,+27821234567,jane.doe@example.com,Johannesburg,Gauteng,Example Retail Credit,4850,4850,2026-06-15
John,Smith,ACC-1002,+27835551234,,Pretoria,Gauteng,Example Retail Credit,12400,11150,2026-05-30`;

type ImportResult = { created: number; skipped: { row: number; reason: string }[] };

export function ImportForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);
  const [csv, setCsv] = useState("");
  const [fileName, setFileName] = useState<string | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  function onFile(file: File | undefined) {
    if (!file) return;
    setFileName(file.name);
    const reader = new FileReader();
    reader.onload = () => setCsv(String(reader.result ?? ""));
    reader.readAsText(file);
  }

  async function submit() {
    setBusy(true);
    setError(null);
    setResult(null);
    try {
      const res = await fetch("/api/debtors/import", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ csv, ...(campaignId ? { campaignId } : {}) }),
      });
      const body = await res.json();
      if (!res.ok) throw new Error(body.message ?? "The import could not be completed.");
      setResult(body);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "The import could not be completed.");
    } finally {
      setBusy(false);
    }
  }

  const rowCount = csv.trim() ? Math.max(0, csv.trim().split("\n").length - 1) : 0;

  if (result) {
    return (
      <div>
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-good/30 bg-good/8 p-4">
          <CheckCircle2 size={18} className="shrink-0 text-good" />
          <p className="text-[0.875rem] text-ink">
            <span className="font-semibold">{result.created} debtor{result.created === 1 ? "" : "s"} imported</span>
            {campaignId ? " and assigned to the campaign" : ""}.
            {result.skipped.length > 0 && (
              <span className="text-ink-2"> {result.skipped.length} row{result.skipped.length === 1 ? " was" : "s were"} skipped.</span>
            )}
          </p>
        </div>
        {result.skipped.length > 0 && (
          <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-line">
            <table className="data-table">
              <thead><tr><th>Row</th><th>Skipped because</th></tr></thead>
              <tbody>
                {result.skipped.map((s) => (
                  <tr key={s.row}><td className="num">{s.row}</td><td className="text-ink-2">{s.reason}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2">
          <Link href="/debtors" className="btn btn-primary">View debtors</Link>
          <button className="btn" onClick={() => { setResult(null); setCsv(""); setFileName(null); }}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
          1 · Prepare a CSV with these columns
        </p>
        <pre className="scroll-x rounded-lg border border-line bg-ink/[0.05] p-3 text-[0.65625rem] leading-relaxed text-ink-2">{TEMPLATE}</pre>
        <div className="mt-2 flex items-center gap-3">
          <button
            className="btn btn-ghost text-[0.71875rem]"
            onClick={() => {
              navigator.clipboard.writeText(TEMPLATE).then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy template"}
          </button>
          <p className="text-[0.65625rem] text-ink-3">
            Required: firstName, lastName, accountNumber, phone, creditorName, originalBalance.
            Optional: email, city, province, currentBalance, dueDate (or daysOverdue).
          </p>
        </div>
      </div>

      <div>
        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">2 · Upload or paste the data</p>
        <div className="grid gap-3 sm:grid-cols-[220px_1fr]">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex h-full min-h-[110px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-ink/[0.025] p-4 text-ink-3 transition-colors hover:border-accent/50 hover:text-ink-2"
          >
            <FileUp size={18} />
            <span className="text-[0.75rem]">{fileName ?? "Choose a .csv file"}</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".csv,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <textarea
            value={csv}
            onChange={(e) => { setCsv(e.target.value); setFileName(null); }}
            rows={5}
            placeholder="…or paste CSV rows here"
            className="field w-full resize-y font-mono text-[0.71875rem]"
          />
        </div>
      </div>

      <div>
        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">3 · Assign to a campaign (optional)</p>
        <Select
          className="min-w-[260px]"
          value={campaignId}
          onChange={setCampaignId}
          aria-label="Campaign"
          options={[
            { value: "", label: "Leave unassigned" },
            ...campaigns.map((c) => ({ value: c.id, label: c.name })),
          ]}
        />
      </div>

      {error && <p className="text-[0.78125rem] text-critical">{error}</p>}
      <button onClick={submit} disabled={busy || !csv.trim()} className="btn btn-primary">
        <Upload size={14} />
        {busy ? "Importing…" : rowCount > 0 ? `Import ${rowCount} row${rowCount === 1 ? "" : "s"}` : "Import"}
      </button>
    </div>
  );
}
