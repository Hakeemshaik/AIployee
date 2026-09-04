import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { detectFormat, findHeaderRow, FORMAT_MAP, parseSheet, dedupeByPhone } from "./import";

describe("real Mafadi file 3 Sep", () => {
  it("detects and parses", () => {
    const wb = XLSX.readFile("/root/.claude/uploads/b6598c0a-2c8f-575e-9d8c-3f35132d3659/bef8446d-A.I._Calls__as_on_the_3_Sept_2026.xlsx");
    const rows = XLSX.utils.sheet_to_json<unknown[]>(wb.Sheets[wb.SheetNames[0]], { header: 1, raw: false, defval: "" });
    const headerRow = findHeaderRow(rows);
    console.log("headerRow:", headerRow, "header:", rows[headerRow ?? 0]);
    expect(headerRow).toBe(1);
    const format = detectFormat(rows[headerRow!]);
    console.log("format:", format);
    expect(format).not.toBeNull();
    const parsed = parseSheet(rows, FORMAT_MAP[format!], "ai-calls.xlsx", headerRow!, format!);
    const deduped = dedupeByPhone(parsed.rows);
    const dialable = deduped.filter((a) => a.phone);
    console.log("rows:", parsed.rows.length, "skipped:", parsed.skipped.length,
      "accounts:", deduped.length, "dialable:", dialable.length,
      "undialable:", deduped.length - dialable.length,
      "book value:", deduped.reduce((s, a) => s + a.totalDue, 0));
    // spot-check shapes only, no PII in assertions
    expect(parsed.rows.length).toBeGreaterThan(150);
    expect(dialable.length).toBeGreaterThan(100);
    for (const a of dialable) expect(a.phone).toMatch(/^\+27\d{9}$/);
  });
});
