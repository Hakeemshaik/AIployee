"use client";

import { useState } from "react";
import { Check, ClipboardCopy, Download, PhoneOutgoing } from "lucide-react";

type ExportResult = {
  csv: string;
  rowCount: number;
  batch: string;
  excluded: { reason: string; count: number }[];
};

export function JobixExport({ campaignId }: { campaignId: string }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ExportResult | null>(null);
  const [copied, setCopied] = useState(false);

  async function load() {
    setOpen(true);
    setBusy(true);
    setError(null);
    try {
      const res = await fetch(`/api/jobix-export?campaignId=${campaignId}&format=json`);
      const body = await res.json();
      if (!res.ok) throw new Error(body.error ?? "Could not build the list");
      setResult(body);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Could not build the list");
    } finally {
      setBusy(false);
    }
  }

  function copy() {
    if (!result) return;
    navigator.clipboard.writeText(result.csv).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }

  return (
    <>
      <button className="btn" onClick={load}>
        <PhoneOutgoing size={13} /> Build Jobix list
      </button>

      {open && (
        <div className="fixed inset-0 z-50 flex items-start justify-center p-4 pt-[8vh]">
          <div className="absolute inset-0 bg-black/60 backdrop-blur-sm" onClick={() => setOpen(false)} />
          <div className="glass-solid relative w-full max-w-xl p-5">
            <div className="mb-4">
              <h2 className="text-[0.9375rem] font-semibold text-ink">Dialling list for Jobix</h2>
              <p className="mt-0.5 text-[0.75rem] text-ink-3">
                Copy this, then paste it into the Jobix dashboard → Database → paste box.
              </p>
            </div>

            {busy && <p className="py-6 text-center text-[0.8125rem] text-ink-3">Building the list…</p>}
            {error && <p className="py-4 text-[0.8125rem] text-[#ec8181]">{error}</p>}

            {result && !busy && (
              <div className="space-y-4">
                <div className="flex flex-wrap items-center gap-3">
                  <span className="text-[1.375rem] font-semibold leading-none text-ink">{result.rowCount}</span>
                  <span className="text-[0.8125rem] text-ink-2">
                    contact{result.rowCount === 1 ? "" : "s"} ready to dial
                  </span>
                  <span className="num rounded-md border border-line bg-white/[0.03] px-2 py-1 text-[0.6875rem] text-ink-3">
                    batch: {result.batch}
                  </span>
                </div>

                {result.excluded.length > 0 && (
                  <div>
                    <p className="mb-1.5 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                      Held back from dialling
                    </p>
                    <ul className="space-y-1">
                      {result.excluded.map((e) => (
                        <li key={e.reason} className="flex justify-between gap-4 text-[0.75rem] text-ink-2">
                          <span className="capitalize">{e.reason}</span>
                          <span className="num">{e.count}</span>
                        </li>
                      ))}
                    </ul>
                  </div>
                )}

                <div className="flex flex-wrap gap-2">
                  <button className="btn btn-primary" onClick={copy} disabled={result.rowCount === 0}>
                    {copied ? <Check size={13} /> : <ClipboardCopy size={13} />}
                    {copied ? "Copied — now paste into Jobix" : "Copy for Jobix"}
                  </button>
                  <a
                    className="btn"
                    href={`/api/jobix-export?campaignId=${campaignId}`}
                    download
                  >
                    <Download size={13} /> Download CSV
                  </a>
                  <button className="btn btn-ghost" onClick={() => setOpen(false)}>
                    Close
                  </button>
                </div>

                <details>
                  <summary className="cursor-pointer text-[0.71875rem] text-ink-3 hover:text-ink-2">
                    Preview the first rows
                  </summary>
                  <pre className="scroll-x mt-2 max-h-40 overflow-y-auto rounded-lg border border-line bg-black/30 p-3 text-[0.625rem] leading-relaxed text-ink-2">
                    {result.csv.split("\n").slice(0, 4).join("\n")}
                  </pre>
                </details>
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
