"use client";

import { useRef, useState } from "react";
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { money } from "@/lib/format";

// ---------------------------------------------------------------------------
// Book file import.
//
// Two-step deliberately: the preview shows what the file will do — created,
// already-on-platform, duplicates, invalid rows with reasons, and which source
// column each field was read from — before a single row is written. The same
// honesty rule as the dialling exclusions: nothing silently dropped.
// ---------------------------------------------------------------------------

type Preview = {
  format: "jobix" | "simple" | "generic";
  mapping: Record<string, string>;
  totalRows: number;
  creatable: number;
  creatableValue: number;
  alreadyOnPlatform: number;
  duplicateInFile: number;
  invalid: { row: number; problem: string }[];
  sample: { name: string; phone: string; balance: number; creditor: string }[];
};

type CommitResult = {
  created: number;
  assignedExisting: number;
  skipped: { row: number; problem: string }[];
};

const FORMAT_LABELS: Record<Preview["format"], string> = {
  jobix: "Jobix import workbook (72 columns)",
  simple: "Platform template",
  generic: "Generic spreadsheet (columns matched by name)",
};

const CONCEPT_LABELS: Record<string, string> = {
  fullName: "Name",
  firstName: "First name",
  lastName: "Last name",
  phone: "Phone",
  email: "Email",
  account: "Account number",
  balance: "Amount owing",
  creditor: "Creditor / building",
  unit: "Unit",
  city: "City",
};

export function FileImport({ campaigns }: { campaigns: { id: string; name: string }[] }) {
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [campaignId, setCampaignId] = useState("");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      if (campaignId) form.set("campaignId", campaignId);
      const response = await fetch("/api/debtors/import-file", { method: "POST", body: form });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message ?? "The file could not be processed.");
      if (mode === "preview") {
        setPreview(body as Preview);
        setResult(null);
      } else {
        setResult(body as CommitResult);
        setPreview(null);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : "The file could not be processed.");
    } finally {
      setBusy(null);
    }
  }

  function chooseFile(selected: File | null) {
    setFile(selected);
    setPreview(null);
    setResult(null);
    setError(null);
  }

  if (result) {
    return (
      <div className="space-y-3">
        <p className="flex items-start gap-2 rounded-lg border border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.08)] px-3 py-2.5 text-[0.8125rem] text-ink">
          <Check size={14} className="mt-0.5 shrink-0 text-[#3ecf9a]" />
          Imported: <span className="num font-medium">{result.created}</span> created
          {result.assignedExisting > 0 && (
            <>
              , <span className="num font-medium">{result.assignedExisting}</span> existing assigned to the campaign
            </>
          )}
          {result.skipped.length > 0 && (
            <>
              , <span className="num font-medium">{result.skipped.length}</span> skipped
            </>
          )}
          .
        </p>
        {result.skipped.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line">
            <table className="data-table">
              <thead>
                <tr><th>Row</th><th>Reason</th></tr>
              </thead>
              <tbody>
                {result.skipped.map((entry) => (
                  <tr key={`${entry.row}-${entry.problem}`}>
                    <td className="num">{entry.row}</td>
                    <td className="text-ink-2">{entry.problem}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <button className="btn" onClick={() => chooseFile(null)}>
          Import another file
        </button>
      </div>
    );
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-3">
        <input
          ref={fileRef}
          type="file"
          accept=".xlsx,.xls,.csv"
          className="hidden"
          onChange={(event) => chooseFile(event.target.files?.[0] ?? null)}
        />
        <button className="btn" onClick={() => fileRef.current?.click()}>
          <Upload size={13} /> Choose file
        </button>
        {file && (
          <span className="flex items-center gap-1.5 text-[0.78125rem] text-ink-2">
            <FileSpreadsheet size={13} className="text-accent" /> {file.name}
          </span>
        )}
        <select
          className="field min-w-[220px]"
          value={campaignId}
          onChange={(event) => setCampaignId(event.target.value)}
          aria-label="Assign to campaign"
        >
          <option value="">No campaign</option>
          {campaigns.map((campaign) => (
            <option key={campaign.id} value={campaign.id}>
              {campaign.name}
            </option>
          ))}
        </select>
        <button className="btn btn-primary" disabled={!file || busy !== null} onClick={() => send("preview")}>
          {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : null}
          Validate file
        </button>
      </div>
      <p className="text-[0.6875rem] leading-relaxed text-ink-3">
        Accepts .xlsx and .csv up to 4 MB — the Jobix import workbook, the platform template, or any
        spreadsheet with name, phone and amount columns. Nothing is written until the validation
        report is confirmed.
      </p>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-[rgba(217,89,38,0.35)] bg-[rgba(217,89,38,0.08)] px-3 py-2 text-[0.78125rem] text-[#e2714a]">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border border-line bg-white/[0.02] p-4">
          <p className="text-[0.78125rem] text-ink">
            Recognised as: <span className="font-medium">{FORMAT_LABELS[preview.format]}</span>
          </p>

          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.1)] px-2.5 py-1 text-[0.6875rem] text-[#3ecf9a]">
              Will be created <span className="num">{preview.creatable}</span> · {money(preview.creatableValue)}
            </span>
            {preview.alreadyOnPlatform > 0 && (
              <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Already on the platform <span className="num">{preview.alreadyOnPlatform}</span>
                {campaignId ? " (will be assigned to the campaign)" : ""}
              </span>
            )}
            {preview.duplicateInFile > 0 && (
              <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Duplicates in file <span className="num">{preview.duplicateInFile}</span>
              </span>
            )}
            {preview.invalid.length > 0 && (
              <span className="rounded-full border border-[rgba(250,178,25,0.3)] bg-[rgba(250,178,25,0.07)] px-2.5 py-1 text-[0.6875rem] text-[#f2c14e]">
                Invalid rows <span className="num">{preview.invalid.length}</span>
              </span>
            )}
          </div>

          {preview.format === "generic" && (
            <p className="text-[0.6875rem] leading-relaxed text-ink-3">
              Columns matched:{" "}
              {Object.entries(preview.mapping)
                .map(([concept, header]) => `${CONCEPT_LABELS[concept] ?? concept} from "${header}"`)
                .join(" · ")}
            </p>
          )}

          {preview.sample.length > 0 && (
            <div className="scroll-x rounded-lg border border-line">
              <table className="data-table">
                <thead>
                  <tr><th>Name</th><th>Phone</th><th className="text-right">Amount</th><th>Creditor</th></tr>
                </thead>
                <tbody>
                  {preview.sample.map((row) => (
                    <tr key={row.phone}>
                      <td className="text-ink">{row.name}</td>
                      <td className="num text-ink-3">{row.phone}</td>
                      <td className="num text-right">{money(row.balance)}</td>
                      <td className="text-ink-3">{row.creditor}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          {preview.invalid.length > 0 && (
            <div className="max-h-40 overflow-y-auto rounded-lg border border-line">
              <table className="data-table">
                <thead>
                  <tr><th>Row</th><th>Problem</th></tr>
                </thead>
                <tbody>
                  {preview.invalid.map((entry) => (
                    <tr key={`${entry.row}-${entry.problem}`}>
                      <td className="num">{entry.row}</td>
                      <td className="text-ink-2">{entry.problem}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}

          <button
            className="btn btn-primary"
            disabled={busy !== null || preview.creatable + (campaignId ? preview.alreadyOnPlatform : 0) === 0}
            onClick={() => send("commit")}
          >
            {busy === "commit" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            Import {preview.creatable} account{preview.creatable === 1 ? "" : "s"}
            {campaignId && preview.alreadyOnPlatform > 0 ? ` and assign ${preview.alreadyOnPlatform} existing` : ""}
          </button>
        </div>
      )}
    </div>
  );
}
