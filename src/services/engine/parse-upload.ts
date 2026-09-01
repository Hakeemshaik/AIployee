import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import {
  detectFormat,
  findHeaderRow,
  FORMAT_MAP,
  headerFingerprint,
  parseSheet,
  type FieldMapping,
  type ParseResult,
} from "./import";

// ---------------------------------------------------------------------------
// Files and pastes → rows → parsed people, or an honest "map this by hand".
//
// When detection cannot decide, the answer is a preview of the first five rows
// and dropdowns — never a guess. A mapping chosen by hand is remembered
// against a fingerprint of the header row, so the same odd layout maps itself
// next month.
// ---------------------------------------------------------------------------

export type UploadInput = { name: string; rows: unknown[][] };

export type NeedsMapping = {
  needsMapping: true;
  file: string;
  fingerprint: string;
  headerRow: number;
  header: string[];
  preview: string[][];
  columnCount: number;
};

export type ParsedUpload =
  | { needsMapping: false; parsed: ParseResult[] }
  | NeedsMapping;

export function rowsFromXlsx(buffer: Buffer): unknown[][] {
  const workbook = XLSX.read(buffer, { type: "buffer" });
  const sheet = workbook.Sheets[workbook.SheetNames[0]];
  // raw:false keeps phone numbers as the text Excel displays, which preserves
  // more digits than the float underneath.
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, { header: 1, raw: false, defval: "" });
}

export function rowsFromPaste(text: string): unknown[][] {
  return text
    .split(/\r?\n/)
    .filter((line) => line.trim() !== "")
    .map((line) => line.split("\t"));
}

/**
 * Parse every input, or stop at the FIRST file that needs a hand — one mapper
 * at a time is followable; five stacked mappers are not.
 */
export async function parseUploads(
  organizationId: string,
  inputs: UploadInput[],
  manual?: { fingerprint: string; mapping: FieldMapping },
): Promise<ParsedUpload> {
  // A hand-picked mapping is remembered before anything else happens, so the
  // work is kept even if a later file in the same batch needs its own.
  if (manual) {
    await db.engineMapping.upsert({
      where: { organizationId_fingerprint: { organizationId, fingerprint: manual.fingerprint } },
      create: {
        organizationId,
        fingerprint: manual.fingerprint,
        mapping: JSON.stringify(manual.mapping),
      },
      update: { mapping: JSON.stringify(manual.mapping) },
    });
  }

  const parsed: ParseResult[] = [];
  for (const input of inputs) {
    const headerRow = findHeaderRow(input.rows);
    if (headerRow === null) {
      return needsMapping(input, 0);
    }
    const header = input.rows[headerRow];
    const fingerprint = headerFingerprint(header);

    // Remembered mappings first — a hand-taught layout beats detection.
    const remembered = await db.engineMapping.findFirst({
      where: { organizationId, fingerprint },
    });
    if (remembered) {
      const mapping = JSON.parse(remembered.mapping) as FieldMapping;
      parsed.push(parseSheet(input.rows, mapping, input.name, headerRow, "manual"));
      continue;
    }

    const format = detectFormat(header);
    if (!format) {
      return needsMapping(input, headerRow);
    }
    const spec = FORMAT_MAP[format];
    const mapping: FieldMapping = {
      tenant: spec.tenant,
      bal: spec.bal,
      phone: spec.phone,
      unit: spec.unit,
      building: spec.building,
      code: spec.code,
    };
    // Formats E and F read the tenant code from a trailing column that some
    // files do not carry; fall back to the leading Prop column.
    if (spec.code !== null && spec.codeFallback !== undefined) {
      const hasCodeColumn = input.rows
        .slice(headerRow + 1, headerRow + 6)
        .some((row) => String(row[spec.code as number] ?? "").trim() !== "");
      if (!hasCodeColumn) mapping.code = spec.codeFallback;
    }
    parsed.push(parseSheet(input.rows, mapping, input.name, headerRow, format));
  }

  return { needsMapping: false, parsed };
}

function needsMapping(input: UploadInput, headerRow: number): NeedsMapping {
  const header = (input.rows[headerRow] ?? []).map((value) => String(value ?? ""));
  return {
    needsMapping: true,
    file: input.name,
    fingerprint: headerFingerprint(input.rows[headerRow] ?? []),
    headerRow,
    header,
    preview: input.rows
      .slice(headerRow, headerRow + 6)
      .map((row) => row.map((value) => String(value ?? ""))),
    columnCount: header.length,
  };
}
