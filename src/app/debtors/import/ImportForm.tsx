"use client";

import Link from "next/link";
import { useRouter } from "next/navigation";
import { useCallback, useRef, useState } from "react";
import { AlertTriangle, CheckCircle2, FileUp, Upload } from "lucide-react";
import { FIELD_LABELS, IMPORT_FIELDS, type ImportField } from "@/lib/import-mapping";

type Column = { index: number; field: ImportField; label: string; header: string | null };

type Preview = {
  fileName: string;
  headerRow: number;
  headerless: boolean;
  headers: string[];
  columns: Column[];
  missingRequired: { field: ImportField; label: string }[];
  totalRows: number;
  willImport: number;
  sample: Record<string, string>[];
  sampleGrid: string[][];
  skipped: { row: number; reason: string }[];
  skippedTotal: number;
};

type ImportResult = {
  created: number;
  skipped: { row: number; reason: string }[];
  skippedTotal?: number;
};

const TEMPLATE = `firstName,lastName,accountNumber,phone,email,city,province,creditorName,originalBalance,currentBalance,dueDate
Nomsa,Khanyile,EDG-5001,0821234567,nomsa.khanyile@gmail.com,Durban,KwaZulu-Natal,Edgars Retail Credit,4850,4850,2026-06-15
Dawie,Kruger,EDG-5002,+27835551234,,Pretoria,Gauteng,Edgars Retail Credit,12400,11150,2026-05-30`;

/** Spreadsheet-style column label: 0 -> A, 25 -> Z, 26 -> AA. */
function columnLetter(index: number): string {
  let n = index + 1;
  let out = "";
  while (n > 0) {
    const rem = (n - 1) % 26;
    out = String.fromCharCode(65 + rem) + out;
    n = Math.floor((n - 1) / 26);
  }
  return out;
}

export function ImportForm({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const router = useRouter();
  const fileInput = useRef<HTMLInputElement>(null);

  const [file, setFile] = useState<File | null>(null);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [overrides, setOverrides] = useState<Record<number, ImportField | "">>({});
  const [defaultCreditor, setDefaultCreditor] = useState("");
  const [csv, setCsv] = useState("");
  const [campaignId, setCampaignId] = useState("");
  const [busy, setBusy] = useState<"preview" | "import" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ImportResult | null>(null);
  const [copied, setCopied] = useState(false);

  /** Ask the server what it makes of the file, without writing anything. */
  const runPreview = useCallback(
    async (
      target: File,
      mapping: Record<number, ImportField | ""> | null,
      creditor: string,
    ) => {
      setBusy("preview");
      setError(null);
      try {
        const body = new FormData();
        body.set("file", target);
        body.set("dryRun", "1");
        if (creditor.trim()) body.set("defaultCreditor", creditor.trim());
        if (mapping) {
          const clean = Object.fromEntries(
            Object.entries(mapping).filter(([, v]) => v !== ""),
          );
          body.set("mapping", JSON.stringify(clean));
        }
        const res = await fetch("/api/debtors/import", { method: "POST", body });
        const json = await res.json();
        if (!res.ok) throw new Error(json.message ?? json.error ?? "Could not read that file");
        setPreview(json);
        if (!mapping) {
          const next: Record<number, ImportField | ""> = {};
          for (const c of json.columns as Column[]) next[c.index] = c.field;
          setOverrides(next);
        }
      } catch (err) {
        setPreview(null);
        setError(err instanceof Error ? err.message : "Could not read that file");
      } finally {
        setBusy(null);
      }
    },
    [],
  );

  function onFile(chosen: File | undefined) {
    if (!chosen) return;
    setFile(chosen);
    setCsv("");
    setResult(null);
    setOverrides({});
    void runPreview(chosen, null, defaultCreditor);
  }

  function changeColumn(index: number, field: ImportField | "") {
    const next = { ...overrides, [index]: field };
    setOverrides(next);
    if (file) void runPreview(file, next, defaultCreditor);
  }

  async function submit() {
    setBusy("import");
    setError(null);
    try {
      let res: Response;
      if (file) {
        const body = new FormData();
        body.set("file", file);
        const clean = Object.fromEntries(Object.entries(overrides).filter(([, v]) => v !== ""));
        body.set("mapping", JSON.stringify(clean));
        if (defaultCreditor.trim()) body.set("defaultCreditor", defaultCreditor.trim());
        if (campaignId) body.set("campaignId", campaignId);
        res = await fetch("/api/debtors/import", { method: "POST", body });
      } else {
        res = await fetch("/api/debtors/import", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ csv, ...(campaignId ? { campaignId } : {}) }),
        });
      }
      const json = await res.json();
      if (!res.ok) throw new Error(json.message ?? json.error ?? "Import failed");
      setResult(json);
      router.refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Import failed");
    } finally {
      setBusy(null);
    }
  }

  function reset() {
    setResult(null);
    setPreview(null);
    setFile(null);
    setCsv("");
    setOverrides({});
    if (fileInput.current) fileInput.current.value = "";
  }

  // --- result ---------------------------------------------------------------

  if (result) {
    const skippedTotal = result.skippedTotal ?? result.skipped.length;
    return (
      <div>
        <div className="mb-4 flex items-center gap-3 rounded-lg border border-[rgba(12,163,12,0.3)] bg-[rgba(12,163,12,0.08)] p-4">
          <CheckCircle2 size={18} className="shrink-0 text-[#5fc46a]" />
          <p className="text-[0.875rem] text-ink">
            <span className="font-semibold">
              {result.created} debtor{result.created === 1 ? "" : "s"} imported
            </span>
            {campaignId ? " and assigned to the campaign" : ""}.
            {skippedTotal > 0 && (
              <span className="text-ink-2">
                {" "}
                {skippedTotal} row{skippedTotal === 1 ? " was" : "s were"} skipped.
              </span>
            )}
          </p>
        </div>
        {result.skipped.length > 0 && (
          <div className="mb-4 max-h-64 overflow-y-auto rounded-lg border border-line">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Skipped because</th>
                </tr>
              </thead>
              <tbody>
                {result.skipped.map((s, i) => (
                  <tr key={`${s.row}-${i}`}>
                    <td className="num">{s.row}</td>
                    <td className="text-ink-2">{s.reason}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="flex gap-2">
          <Link href="/debtors" className="btn btn-primary">
            View debtors
          </Link>
          <button className="btn" onClick={reset}>
            Import another file
          </button>
        </div>
      </div>
    );
  }

  // --- form -----------------------------------------------------------------

  const width = preview
    ? Math.max(preview.headers.length, ...preview.sampleGrid.map((r) => r.length), 0)
    : 0;
  const pasteRows = csv.trim() ? Math.max(0, csv.trim().split("\n").length - 1) : 0;
  const canImport = file ? (preview?.willImport ?? 0) > 0 : pasteRows > 0;

  return (
    <div className="space-y-5">
      <div>
        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">1 · Upload your file</p>
        <div className="grid gap-3 sm:grid-cols-[240px_1fr]">
          <button
            type="button"
            onClick={() => fileInput.current?.click()}
            className="flex h-full min-h-[110px] flex-col items-center justify-center gap-2 rounded-xl border border-dashed border-line bg-white/[0.02] p-4 text-ink-3 transition-colors hover:border-[rgba(57,135,229,0.5)] hover:text-ink-2"
          >
            <FileUp size={18} />
            <span className="text-[0.75rem]">{file?.name ?? "Choose a spreadsheet"}</span>
            <span className="text-[0.65625rem] text-ink-3">.xlsx, .csv or tab-separated</span>
          </button>
          <input
            ref={fileInput}
            type="file"
            accept=".xlsx,.csv,.tsv,.txt,.xls,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet,text/csv"
            className="hidden"
            onChange={(e) => onFile(e.target.files?.[0])}
          />
          <div className="space-y-2">
            <p className="text-[0.71875rem] text-ink-2">
              Any layout works — the columns are detected from the file itself, so an export
              with no header row still imports. Names, phone numbers and amounts are cleaned
              on the way in: titles stripped, numbers normalised to +27, amounts rounded to
              whole rand.
            </p>
            <details className="text-[0.65625rem] text-ink-3">
              <summary className="cursor-pointer hover:text-ink-2">
                Or paste CSV rows instead
              </summary>
              <textarea
                value={csv}
                onChange={(e) => {
                  setCsv(e.target.value);
                  setFile(null);
                  setPreview(null);
                }}
                rows={4}
                placeholder="firstName,lastName,accountNumber,phone,…"
                className="field mt-2 w-full resize-y font-mono text-[0.71875rem]"
              />
              <button
                className="btn btn-ghost mt-1 text-[0.65625rem]"
                onClick={() => {
                  navigator.clipboard.writeText(TEMPLATE).then(() => {
                    setCopied(true);
                    setTimeout(() => setCopied(false), 1500);
                  });
                }}
              >
                {copied ? "Copied" : "Copy template"}
              </button>
            </details>
          </div>
        </div>
      </div>

      {busy === "preview" && (
        <p className="text-[0.78125rem] text-ink-2">Reading {file?.name}…</p>
      )}

      {preview && (
        <>
          <div>
            <div className="mb-2 flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[0.71875rem] font-medium text-ink-2">
                2 · Check the detected columns
              </p>
              <p className="text-[0.65625rem] text-ink-3">
                {preview.headerless
                  ? "No header row found — columns identified by their contents"
                  : `Header row ${preview.headerRow + 1}`}
                {" · "}
                {preview.willImport} of {preview.totalRows} rows will import
              </p>
            </div>

            {preview.missingRequired.length > 0 && (
              <div className="mb-3 flex items-start gap-2 rounded-lg border border-[rgba(217,119,6,0.35)] bg-[rgba(217,119,6,0.08)] p-3">
                <AlertTriangle size={15} className="mt-0.5 shrink-0 text-[#e0a244]" />
                <p className="text-[0.75rem] text-ink-2">
                  Could not find:{" "}
                  <span className="font-medium text-ink">
                    {preview.missingRequired.map((m) => m.label).join(", ")}
                  </span>
                  . Set the right column below, or those rows will be skipped.
                </p>
              </div>
            )}

            <div className="scroll-x rounded-lg border border-line">
              <table className="data-table">
                <thead>
                  <tr>
                    {Array.from({ length: width }, (_, i) => (
                      <th key={i} className="min-w-[150px]">
                        <div className="mb-1 text-[0.625rem] text-ink-3">
                          {columnLetter(i)}
                          {preview.headers[i] ? ` · ${preview.headers[i]}` : ""}
                        </div>
                        <select
                          className="field w-full text-[0.6875rem]"
                          value={overrides[i] ?? ""}
                          onChange={(e) => changeColumn(i, e.target.value as ImportField | "")}
                        >
                          <option value="">Ignore</option>
                          {IMPORT_FIELDS.map((f) => (
                            <option key={f} value={f}>
                              {FIELD_LABELS[f]}
                            </option>
                          ))}
                        </select>
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.sampleGrid.slice(0, 5).map((row, r) => (
                    <tr key={r}>
                      {Array.from({ length: width }, (_, c) => (
                        <td key={c} className="text-ink-2">
                          {row[c] ?? ""}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>

          {preview.sample.length > 0 && (
            <div>
              <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
                3 · This is what will be created
              </p>
              <div className="scroll-x rounded-lg border border-line">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Name</th>
                      <th>Phone</th>
                      <th>Reference</th>
                      <th>Creditor</th>
                      <th className="num">Balance</th>
                    </tr>
                  </thead>
                  <tbody>
                    {preview.sample.slice(0, 5).map((row, i) => (
                      <tr key={i}>
                        <td>
                          {row.firstName} {row.lastName}
                        </td>
                        <td className="mono">{row.phone}</td>
                        <td className="text-ink-2">{row.accountNumber}</td>
                        <td className="text-ink-2">{row.creditorName}</td>
                        <td className="num">
                          R{Number(row.currentBalance ?? row.originalBalance).toLocaleString("en-ZA")}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {preview.skippedTotal > 0 && (
            <details className="rounded-lg border border-line p-3">
              <summary className="cursor-pointer text-[0.75rem] text-ink-2">
                {preview.skippedTotal} row{preview.skippedTotal === 1 ? "" : "s"} will be skipped
              </summary>
              <div className="mt-2 max-h-48 overflow-y-auto">
                <table className="data-table">
                  <tbody>
                    {preview.skipped.map((s, i) => (
                      <tr key={`${s.row}-${i}`}>
                        <td className="num w-16">{s.row}</td>
                        <td className="text-ink-3">{s.reason}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </details>
          )}

          <div>
            <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
              Creditor name for rows without one (optional)
            </p>
            <input
              className="field min-w-[260px]"
              value={defaultCreditor}
              placeholder="e.g. Mafadi Property Management"
              onChange={(e) => setDefaultCreditor(e.target.value)}
              onBlur={() => file && runPreview(file, overrides, defaultCreditor)}
            />
          </div>
        </>
      )}

      <div>
        <p className="mb-2 text-[0.71875rem] font-medium text-ink-2">
          {preview ? "4" : "2"} · Assign to a campaign (optional)
        </p>
        <select
          className="field min-w-[260px]"
          value={campaignId}
          onChange={(e) => setCampaignId(e.target.value)}
        >
          <option value="">Leave unassigned</option>
          {campaigns.map((c) => (
            <option key={c.id} value={c.id}>
              {c.name}
            </option>
          ))}
        </select>
      </div>

      {error && <p className="text-[0.78125rem] text-[#ec8181]">{error}</p>}

      <button onClick={submit} disabled={busy !== null || !canImport} className="btn btn-primary">
        <Upload size={14} />
        {busy === "import"
          ? "Importing…"
          : file
            ? `Import ${preview?.willImport ?? 0} row${preview?.willImport === 1 ? "" : "s"}`
            : pasteRows > 0
              ? `Import ${pasteRows} row${pasteRows === 1 ? "" : "s"}`
              : "Import"}
      </button>
    </div>
  );
}
