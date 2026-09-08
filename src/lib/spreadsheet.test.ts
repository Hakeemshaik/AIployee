import ExcelJS from "exceljs";
import { describe, expect, it } from "vitest";
import { SpreadsheetError, parseSpreadsheet } from "./spreadsheet";
import { buildRows, detectMapping } from "./import-mapping";

/** Build a real .xlsx in memory so the binary path is genuinely exercised. */
async function makeXlsx(rows: unknown[][], sheetName = "Sheet1"): Promise<Buffer> {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(sheetName);
  rows.forEach((r) => ws.addRow(r));
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe("parseSpreadsheet — xlsx", () => {
  it("reads a headed workbook into a grid", async () => {
    const buffer = await makeXlsx([
      ["First Name", "Surname", "Cell", "Balance"],
      ["Thandi", "Nkosi", "0821234567", 4850],
      ["Dawie", "Kruger", "+27835551234", 12400],
    ]);
    const grid = await parseSpreadsheet(buffer, "book.xlsx");
    expect(grid).toEqual([
      ["First Name", "Surname", "Cell", "Balance"],
      ["Thandi", "Nkosi", "0821234567", "4850"],
      ["Dawie", "Kruger", "+27835551234", "12400"],
    ]);
  });

  it("keeps a number-typed phone cell usable", async () => {
    // Excel silently turns 0821234567 into the number 821234567.
    const buffer = await makeXlsx([
      ["Name", "Cell", "Balance"],
      ["Thandi Nkosi", 821234567, 4850],
    ]);
    const grid = await parseSpreadsheet(buffer, "book.xlsx");
    expect(grid[1][1]).toBe("821234567");
  });

  it("renders dates as ISO rather than a locale-ambiguous string", async () => {
    const buffer = await makeXlsx([
      ["Name", "Cell", "Balance", "Due Date"],
      ["Thandi Nkosi", "0821234567", 4850, new Date(Date.UTC(2026, 2, 4))],
    ]);
    const grid = await parseSpreadsheet(buffer, "book.xlsx");
    expect(grid[1][3]).toBe("2026-03-04");
  });

  it("skips an empty cover sheet and reads the one with data", async () => {
    const wb = new ExcelJS.Workbook();
    wb.addWorksheet("Cover").addRow(["Arrears report"]);
    const ws = wb.addWorksheet("Data");
    ws.addRow(["Name", "Cell", "Balance"]);
    ws.addRow(["Thandi Nkosi", "0821234567", 4850]);
    const grid = await parseSpreadsheet(Buffer.from(await wb.xlsx.writeBuffer()), "b.xlsx");
    expect(grid[0]).toEqual(["Name", "Cell", "Balance"]);
  });

  it("imports a headerless property export end to end", async () => {
    const buffer = await makeXlsx([
      ["MPM01", "Hillbrow Heights", "204", 2, "Flat", "204", "NKOSI T", 15600, "0821234567"],
      ["MPM01", "Hillbrow Heights", "311", 3, "Flat", "311", "DLAMINI S", 7800, "0837654321"],
      ["MPM02", "Berea Court", "12", 1, "Duplex", "12", "VAN WYK A", 4200, "0609998888"],
      ["MPM02", "Berea Court", "18", 1, "Duplex", "18", "PILLAY R", 31000, "0834445555"],
    ]);
    const grid = await parseSpreadsheet(buffer, "arrears.xlsx");
    const detected = detectMapping(grid);
    const { rows, skipped } = buildRows(grid, detected);

    expect(detected.headerless).toBe(true);
    expect(detected.missingRequired).toEqual([]);
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(4);
    expect(rows[0]).toMatchObject({
      firstName: "T",
      lastName: "Nkosi",
      phone: "+27821234567",
      creditorName: "Hillbrow Heights",
      originalBalance: "15600",
    });
    expect(rows[2]).toMatchObject({ lastName: "Van Wyk", creditorName: "Berea Court" });
  });
});

describe("parseSpreadsheet — delimited text", () => {
  const csv = "Name,Cell,Balance\nThandi Nkosi,0821234567,4850\n";

  it("reads csv", async () => {
    const grid = await parseSpreadsheet(Buffer.from(csv), "book.csv");
    expect(grid[1]).toEqual(["Thandi Nkosi", "0821234567", "4850"]);
  });

  it("reads semicolon and tab separated exports", async () => {
    const semi = await parseSpreadsheet(Buffer.from("Name;Cell;Balance\nThandi;0821234567;4850"), "a.csv");
    expect(semi[1]).toEqual(["Thandi", "0821234567", "4850"]);
    const tabbed = await parseSpreadsheet(Buffer.from("Name\tCell\tBalance\nThandi\t0821234567\t4850"), "a.txt");
    expect(tabbed[1]).toEqual(["Thandi", "0821234567", "4850"]);
  });

  it("strips a UTF-8 BOM so the first header still matches", async () => {
    const grid = await parseSpreadsheet(Buffer.from("﻿" + csv), "book.csv");
    expect(grid[0][0]).toBe("Name");
  });
});

describe("parseSpreadsheet — rejections", () => {
  it("explains what to do with a legacy .xls", async () => {
    const ole2 = Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0xa1, 0xb1, 0x1a, 0xe1, 0, 0]);
    await expect(parseSpreadsheet(ole2, "old.xls")).rejects.toThrow(/save it as \.xlsx/i);
  });

  it("rejects an empty file", async () => {
    await expect(parseSpreadsheet(Buffer.alloc(0), "empty.csv")).rejects.toBeInstanceOf(SpreadsheetError);
  });

  it("rejects a file that is neither a workbook nor text", async () => {
    const png = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x01]);
    await expect(parseSpreadsheet(png, "logo.png")).rejects.toThrow(/not a spreadsheet/i);
  });

  it("reads a .xlsx even when it is misnamed .xls", async () => {
    // Exports are routinely named .xls while actually being .xlsx.
    const buffer = await makeXlsx([["Name", "Cell", "Balance"], ["Thandi", "0821234567", 4850]]);
    const grid = await parseSpreadsheet(buffer, "mislabelled.xls");
    expect(grid[0][0]).toBe("Name");
  });
});
