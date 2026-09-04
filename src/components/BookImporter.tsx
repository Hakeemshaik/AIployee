"use client";

import { useRef, useState } from "react";
import { useRouter } from "next/navigation";
import { AlertTriangle, Check, FileSpreadsheet, Loader2, Upload } from "lucide-react";
import { Select } from "@/components/Select";
import { count, money } from "@/lib/format";

// ---------------------------------------------------------------------------
// Book file import.
//
// Three steps, deliberately: choose the file and how to read it, review the
// whole sheet exactly as it will land, then import. The review is the point —
// it is a rehearsal of the write, row for row, with the verdict commitBook
// will reach on each one, so nothing is ever created off a guess about a
// client's column names.
//
// The same component serves the general import screen (pick a campaign) and a
// campaign's own page (campaign fixed).
// ---------------------------------------------------------------------------

type RowStatus = "create" | "update" | "unchanged" | "duplicate" | "invalid";

type PreviewRow = {
  row: number;
  status: RowStatus;
  note: string | null;
  cells: (string | number | null)[];
};

type Preview = {
  format: "mafadi" | "jobix" | "simple" | "generic";
  detectedFormat: "mafadi" | "jobix" | "simple" | "generic";
  mapping: Record<string, string>;
  totalRows: number;
  creatable: number;
  creatableValue: number;
  updatable: number;
  unchanged: number;
  duplicateInFile: number;
  invalid: { row: number; problem: string }[];
  grid: { columns: string[]; rows: PreviewRow[]; truncated: number };
};

type CommitResult = {
  created: number;
  updated: number;
  unchanged: number;
  skipped: { row: number; problem: string }[];
};

const FORMAT_OPTIONS = [
  { value: "auto", label: "Detect automatically" },
  { value: "jobix", label: "Jobix import workbook (72 columns)" },
  { value: "simple", label: "Platform template" },
  { value: "generic", label: "Any spreadsheet — match columns by name" },
] as const;

const FORMAT_LABELS: Record<Preview["format"], string> = {
  mafadi: "Raw arrears export — cleaned automatically (names, phones, whole rands)",
  jobix: "Jobix import workbook (72 columns)",
  simple: "Platform template",
  generic: "Generic spreadsheet, columns matched by name",
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

const STATUS_STYLE: Record<RowStatus, { label: string; className: string }> = {
  create: { label: "New", className: "text-good" },
  update: { label: "Update", className: "text-accent" },
  unchanged: { label: "No change", className: "text-ink-3" },
  duplicate: { label: "Duplicate", className: "text-ink-3" },
  invalid: { label: "Excluded", className: "text-warning" },
};

/** The money column is rendered as money; everything else as text. */
const MONEY_COLUMN = 3;

export function BookImporter({
  campaigns = [],
  fixedCampaign,
}: {
  /** Offered as a picker. Ignored when fixedCampaign is set. */
  campaigns?: { id: string; name: string }[];
  /** Import straight into this campaign — used on the campaign's own page. */
  fixedCampaign?: { id: string; name: string };
}) {
  const router = useRouter();
  const fileRef = useRef<HTMLInputElement>(null);
  const [file, setFile] = useState<File | null>(null);
  const [campaignId, setCampaignId] = useState(fixedCampaign?.id ?? "");
  const [format, setFormat] = useState<string>("auto");
  const [preview, setPreview] = useState<Preview | null>(null);
  const [result, setResult] = useState<CommitResult | null>(null);
  const [busy, setBusy] = useState<"preview" | "commit" | null>(null);
  const [error, setError] = useState<string | null>(null);

  const targetCampaign = fixedCampaign?.id ?? campaignId;

  async function send(mode: "preview" | "commit") {
    if (!file) return;
    setBusy(mode);
    setError(null);
    try {
      const form = new FormData();
      form.set("file", file);
      form.set("mode", mode);
      form.set("format", format);
      if (targetCampaign) form.set("campaignId", targetCampaign);
      const response = await fetch("/api/debtors/import-file", { method: "POST", body: form });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) {
        throw new Error(body.message ?? body.error ?? "The file could not be processed.");
      }
      if (mode === "preview") {
        setPreview(body as Preview);
        setResult(null);
      } else {
        setResult(body as CommitResult);
        setPreview(null);
        // The campaign page shows the imported accounts, so refresh the server
        // components rather than leaving a stale list behind.
        router.refresh();
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
        <p className="flex items-start gap-2 rounded-lg border border-good/35 bg-good/8 px-3 py-2.5 text-[0.8125rem] text-ink">
          <Check size={14} className="mt-0.5 shrink-0 text-good" />
          Imported: <span className="num font-medium">{count(result.created)}</span> created,{" "}
          <span className="num font-medium">{count(result.updated)}</span> updated
          {result.unchanged > 0 && (
            <>
              , <span className="num font-medium">{count(result.unchanged)}</span> already up to date
            </>
          )}
          {result.skipped.length > 0 && (
            <>
              , <span className="num font-medium">{count(result.skipped.length)}</span> skipped
            </>
          )}
          .
        </p>
        {result.skipped.length > 0 && (
          <div className="max-h-48 overflow-y-auto rounded-lg border border-line">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Row</th>
                  <th>Reason</th>
                </tr>
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
        <Select
          className="min-w-[240px]"
          value={format}
          onChange={setFormat}
          aria-label="File format"
          options={FORMAT_OPTIONS.map((option) => ({ value: option.value, label: option.label }))}
        />
        {!fixedCampaign && (
          <Select
            className="min-w-[220px]"
            value={campaignId}
            onChange={setCampaignId}
            aria-label="Assign to campaign"
            options={[
              { value: "", label: "No campaign" },
              ...campaigns.map((campaign) => ({ value: campaign.id, label: campaign.name })),
            ]}
          />
        )}
        <button className="btn btn-primary" disabled={!file || busy !== null} onClick={() => send("preview")}>
          {busy === "preview" ? <Loader2 size={13} className="animate-spin" /> : null}
          Review file
        </button>
      </div>
      <p className="text-[0.6875rem] leading-relaxed text-ink-3">
        Accepts .xlsx and .csv up to 4 MB — the Jobix import workbook, the platform template, or any
        spreadsheet with name, phone and amount columns.
        {fixedCampaign ? ` Imported accounts are assigned to ${fixedCampaign.name}.` : ""} Nothing is written
        until the review below is confirmed.
      </p>

      {error && (
        <p className="flex items-start gap-2 rounded-lg border border-serious/35 bg-serious/8 px-3 py-2 text-[0.78125rem] text-serious">
          <AlertTriangle size={13} className="mt-0.5 shrink-0" />
          {error}
        </p>
      )}

      {preview && (
        <div className="space-y-3 rounded-lg border border-line bg-ink/[0.025] p-4">
          <p className="text-[0.78125rem] text-ink">
            Read as: <span className="font-medium">{FORMAT_LABELS[preview.format]}</span>
            {preview.format !== preview.detectedFormat && (
              <span className="text-ink-3">
                {" "}
                — the headers look like {FORMAT_LABELS[preview.detectedFormat].toLowerCase()}, so check the
                columns below before importing.
              </span>
            )}
          </p>

          <div className="flex flex-wrap gap-1.5">
            <span className="rounded-full border border-good/35 bg-good/10 px-2.5 py-1 text-[0.6875rem] text-good">
              Will be created <span className="num">{count(preview.creatable)}</span> ·{" "}
              {money(preview.creatableValue)}
            </span>
            {preview.updatable > 0 && (
              <span className="rounded-full border border-accent/45 bg-accent-soft px-2.5 py-1 text-[0.6875rem] text-ink">
                Will be updated <span className="num">{count(preview.updatable)}</span>
              </span>
            )}
            {preview.unchanged > 0 && (
              <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-3">
                Already up to date <span className="num">{count(preview.unchanged)}</span>
              </span>
            )}
            {preview.duplicateInFile > 0 && (
              <span className="rounded-full border border-line bg-ink/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Duplicates in file <span className="num">{count(preview.duplicateInFile)}</span>
              </span>
            )}
            {preview.invalid.length > 0 && (
              <span className="rounded-full border border-warning/30 bg-warning/7 px-2.5 py-1 text-[0.6875rem] text-warning">
                Excluded rows <span className="num">{count(preview.invalid.length)}</span>
              </span>
            )}
          </div>

          <p className="text-[0.6875rem] leading-relaxed text-ink-3">
            Columns read:{" "}
            {Object.entries(preview.mapping)
              .map(([concept, header]) => `${CONCEPT_LABELS[concept] ?? concept} from "${header}"`)
              .join(" · ") || "none matched — try naming the format explicitly"}
          </p>

          {preview.grid.rows.length > 0 && (
            <div className="scroll-x max-h-[26rem] overflow-y-auto rounded-lg border border-line">
              <table className="data-table">
                <thead>
                  <tr>
                    <th className="w-14">Row</th>
                    <th className="w-24">Status</th>
                    {preview.grid.columns.map((column, index) => (
                      <th key={column} className={index === MONEY_COLUMN ? "text-right" : undefined}>
                        {column}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {preview.grid.rows.map((row) => {
                    const status = STATUS_STYLE[row.status];
                    return (
                      <tr
                        key={row.row}
                        className={row.status === "create" || row.status === "update" ? undefined : "opacity-70"}
                      >
                        <td className="num text-ink-3">{row.row}</td>
                        <td className={`text-[0.6875rem] ${status.className}`} title={row.note ?? undefined}>
                          {status.label}
                        </td>
                        {row.cells.map((cell, index) => (
                          <td
                            key={index}
                            className={
                              index === MONEY_COLUMN ? "num text-right" : index === 0 ? "text-ink" : "text-ink-3"
                            }
                          >
                            {cell === null || cell === ""
                              ? "—"
                              : index === MONEY_COLUMN
                                ? money(Number(cell))
                                : String(cell)}
                          </td>
                        ))}
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}

          {preview.grid.truncated > 0 && (
            <p className="text-[0.6875rem] text-ink-3">
              Showing the first <span className="num">{count(preview.grid.rows.length)}</span> of{" "}
              <span className="num">{count(preview.totalRows)}</span> rows. All{" "}
              <span className="num">{count(preview.totalRows)}</span> are validated and will be imported —
              only the display is capped.
            </p>
          )}

          {preview.invalid.length > 0 && (
            <details className="rounded-lg border border-line">
              <summary className="cursor-pointer px-3 py-2 text-[0.71875rem] text-ink-2">
                Why {count(preview.invalid.length)} row{preview.invalid.length === 1 ? " was" : "s were"}{" "}
                excluded
              </summary>
              <div className="max-h-40 overflow-y-auto border-t border-line-2">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Row</th>
                      <th>Problem</th>
                    </tr>
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
            </details>
          )}

          <button
            className="btn btn-primary"
            disabled={busy !== null || preview.creatable + preview.updatable === 0}
            onClick={() => send("commit")}
          >
            {busy === "commit" ? <Loader2 size={13} className="animate-spin" /> : <Check size={13} />}
            {preview.creatable > 0 && preview.updatable > 0
              ? `Import ${count(preview.creatable)} new and update ${count(preview.updatable)}`
              : preview.updatable > 0
                ? `Update ${count(preview.updatable)} account${preview.updatable === 1 ? "" : "s"}`
                : `Import ${count(preview.creatable)} account${preview.creatable === 1 ? "" : "s"}`}
          </button>
        </div>
      )}
    </div>
  );
}
