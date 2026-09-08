import { NextResponse } from "next/server";
import { z } from "zod";
import { getContext } from "@/lib/auth";
import { csvToObjects } from "@/lib/csv";
import {
  buildRows,
  detectMapping,
  FIELD_LABELS,
  IMPORT_FIELDS,
  type ColumnMapping,
  type DetectedMapping,
  type ImportField,
} from "@/lib/import-mapping";
import { SpreadsheetError, parseSpreadsheet } from "@/lib/spreadsheet";
import { importDebtors } from "@/services/debtors";

// POST /api/debtors/import
//
// Two request shapes:
//   multipart/form-data — a .xlsx/.csv/.tsv upload. Columns are detected from
//     the file, so it does not have to match a template. `dryRun=1` returns the
//     detected mapping and a preview without writing anything.
//   application/json    — the original { csv } body, kept so existing callers
//     and the paste box keep working.

export const runtime = "nodejs";

const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
const MAX_ROWS = 5000;
const PREVIEW_ROWS = 12;

const jsonSchema = z.object({
  csv: z.string().min(1).max(2_000_000),
  campaignId: z.string().optional(),
});

// Normalized CSV header → import field, for the JSON paste path.
const HEADER_MAP: Record<string, string> = {
  firstname: "firstName",
  lastname: "lastName",
  accountnumber: "accountNumber",
  account: "accountNumber",
  phone: "phone",
  phonenumber: "phone",
  email: "email",
  city: "city",
  province: "province",
  creditorname: "creditorName",
  creditor: "creditorName",
  originalbalance: "originalBalance",
  currentbalance: "currentBalance",
  balance: "currentBalance",
  duedate: "dueDate",
  daysoverdue: "daysOverdue",
};

/** Parse a `{"3":"phone"}` style override posted by the mapping editor. */
function parseMappingOverride(raw: string | null): ColumnMapping | null {
  if (!raw) return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object") return null;

  const valid = new Set<string>(IMPORT_FIELDS);
  const mapping: ColumnMapping = {};
  for (const [key, value] of Object.entries(parsed as Record<string, unknown>)) {
    const index = Number(key);
    if (!Number.isInteger(index) || index < 0) continue;
    if (typeof value === "string" && valid.has(value)) {
      mapping[index] = value as ImportField;
    }
  }
  return mapping;
}

function describeMapping(detected: DetectedMapping) {
  return Object.entries(detected.mapping)
    .map(([index, field]) => ({
      index: Number(index),
      field: field as ImportField,
      label: FIELD_LABELS[field as ImportField],
      header: detected.headers[Number(index)] ?? null,
    }))
    .sort((a, b) => a.index - b.index);
}

async function handleUpload(request: Request) {
  const form = await request.formData();
  const file = form.get("file");
  if (!(file instanceof File)) {
    return NextResponse.json(
      { error: "no_file", message: "Attach a .xlsx, .csv or tab-separated file." },
      { status: 422 },
    );
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      {
        error: "file_too_large",
        message: `That file is ${(file.size / 1024 / 1024).toFixed(1)} MB. Split it into files under 10 MB.`,
      },
      { status: 413 },
    );
  }

  const buffer = Buffer.from(await file.arrayBuffer());
  const grid = await parseSpreadsheet(buffer, file.name);

  const detected = detectMapping(grid);
  const override = parseMappingOverride(
    typeof form.get("mapping") === "string" ? String(form.get("mapping")) : null,
  );
  // An override replaces detection outright — a column the operator cleared
  // must stay cleared rather than being re-detected underneath them.
  const effective: DetectedMapping = override
    ? { ...detected, mapping: override }
    : detected;

  const defaultCreditor =
    typeof form.get("defaultCreditor") === "string"
      ? String(form.get("defaultCreditor")).trim()
      : "";

  const { rows, skipped } = buildRows(grid, effective, {
    defaultCreditor: defaultCreditor || undefined,
  });

  const dryRun = String(form.get("dryRun") ?? "") === "1";
  const campaignId = typeof form.get("campaignId") === "string" ? String(form.get("campaignId")) : "";

  if (dryRun) {
    return NextResponse.json({
      preview: true,
      fileName: file.name,
      headerRow: effective.headerRow,
      headerless: effective.headerless,
      headers: effective.headers,
      columns: describeMapping(effective),
      missingRequired: effective.missingRequired.map((f) => ({ field: f, label: FIELD_LABELS[f] })),
      totalRows: grid.length - effective.dataStart,
      willImport: rows.length,
      sample: rows.slice(0, PREVIEW_ROWS),
      sampleGrid: grid.slice(effective.dataStart, effective.dataStart + PREVIEW_ROWS),
      skipped: skipped.slice(0, 50),
      skippedTotal: skipped.length,
    });
  }

  if (rows.length === 0) {
    return NextResponse.json(
      {
        error: "nothing_to_import",
        message:
          skipped.length > 0
            ? `No rows could be imported. First problem: ${skipped[0].reason}.`
            : "No rows could be read from that file.",
        skipped: skipped.slice(0, 50),
      },
      { status: 422 },
    );
  }
  if (rows.length > MAX_ROWS) {
    return NextResponse.json(
      { error: "too_many_rows", message: `Import at most ${MAX_ROWS} rows per batch.` },
      { status: 422 },
    );
  }

  const ctx = await getContext();
  const result = await importDebtors(
    ctx.organizationId,
    ctx.userId,
    rows,
    campaignId || undefined,
  );

  // Rows dropped during mapping are as much a part of the outcome as rows
  // rejected during validation, so they are reported together.
  return NextResponse.json(
    {
      created: result.created,
      skipped: [...skipped, ...result.skipped].slice(0, 200),
      skippedTotal: skipped.length + result.skipped.length,
      columns: describeMapping(effective),
    },
    { status: 201 },
  );
}

async function handleJson(request: Request) {
  const body = await request.json();
  const parsed = jsonSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: "validation_failed", issues: z.treeifyError(parsed.error) },
      { status: 422 },
    );
  }
  const objects = csvToObjects(parsed.data.csv);
  if (objects.length === 0) {
    return NextResponse.json(
      { error: "empty_csv", message: "The CSV needs a header row and at least one data row." },
      { status: 422 },
    );
  }
  if (objects.length > MAX_ROWS) {
    return NextResponse.json(
      { error: "too_many_rows", message: `Import at most ${MAX_ROWS} rows per batch.` },
      { status: 422 },
    );
  }
  const rows = objects.map((obj) => {
    const mapped: Record<string, string> = {};
    for (const [key, value] of Object.entries(obj)) {
      const field = HEADER_MAP[key];
      if (field && value !== "") mapped[field] = value;
    }
    return mapped;
  });
  const ctx = await getContext();
  const result = await importDebtors(ctx.organizationId, ctx.userId, rows, parsed.data.campaignId);
  return NextResponse.json(result, { status: 201 });
}

export async function POST(request: Request) {
  try {
    const contentType = request.headers.get("content-type") ?? "";
    return contentType.includes("multipart/form-data")
      ? await handleUpload(request)
      : await handleJson(request);
  } catch (err) {
    if (err instanceof SpreadsheetError) {
      return NextResponse.json({ error: "unreadable_file", message: err.message }, { status: 422 });
    }
    const message = err instanceof Error ? err.message : "internal_error";
    const status = message.includes("not found") ? 404 : 500;
    if (status === 500) console.error("[debtors] import failed:", err);
    return NextResponse.json({ error: message }, { status });
  }
}
