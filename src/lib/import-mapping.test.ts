import { describe, expect, it } from "vitest";
import {
  buildRows,
  cleanName,
  detectHeaderRow,
  detectMapping,
  parseAmount,
  splitName,
} from "./import-mapping";
import { detectDelimiter } from "./spreadsheet";

describe("parseAmount", () => {
  it("reads plain numbers", () => {
    expect(parseAmount("1500")).toBe(1500);
    expect(parseAmount("1500.50")).toBe(1500.5);
    expect(parseAmount("0")).toBe(0);
  });

  it("strips currency symbols and spacing", () => {
    expect(parseAmount("R 1 234.56")).toBe(1234.56);
    expect(parseAmount("R15600")).toBe(15600);
    expect(parseAmount(" 1 500 ")).toBe(1500);
  });

  it("handles both thousands conventions", () => {
    expect(parseAmount("1,234.56")).toBe(1234.56); // en-US
    expect(parseAmount("1.234,56")).toBe(1234.56); // en-ZA / European
    expect(parseAmount("1,500")).toBe(1500); // thousands group
    expect(parseAmount("1,50")).toBe(1.5); // decimal comma
  });

  it("reads accounting negatives", () => {
    expect(parseAmount("(1234)")).toBe(-1234);
    expect(parseAmount("-1234")).toBe(-1234);
    expect(parseAmount("(R 1 234.00)")).toBe(-1234);
  });

  it("rejects anything that is not a number", () => {
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("n/a")).toBeNull();
    expect(parseAmount("Hillbrow")).toBeNull();
    expect(parseAmount("12A")).toBeNull();
  });
});

describe("cleanName / splitName", () => {
  it("strips titles and normalises case", () => {
    expect(cleanName("MR THANDI NKOSI")).toBe("Thandi Nkosi");
    expect(cleanName("mrs. j. van der merwe")).toBe("J Van Der Merwe");
    expect(cleanName("  DR  Sipho   Dlamini ")).toBe("Sipho Dlamini");
  });

  it("leaves deliberately mixed capitals alone", () => {
    expect(cleanName("Sarah McDonald")).toBe("Sarah McDonald");
  });

  it("splits surname-first with a comma", () => {
    expect(splitName("NKOSI, Thandi")).toEqual({ firstName: "Thandi", lastName: "Nkosi" });
  });

  it("splits surname followed by initials", () => {
    expect(splitName("NKOSI T")).toEqual({ firstName: "T", lastName: "Nkosi" });
    expect(splitName("DLAMINI TM")).toEqual({ firstName: "TM", lastName: "Dlamini" });
  });

  it("splits given-name-first", () => {
    expect(splitName("Thandi Nkosi")).toEqual({ firstName: "Thandi", lastName: "Nkosi" });
    expect(splitName("Jan van der Merwe")).toEqual({ firstName: "Jan", lastName: "Van Der Merwe" });
  });

  it("handles a single token", () => {
    expect(splitName("Thandi")).toEqual({ firstName: "Thandi", lastName: "" });
    expect(splitName("")).toEqual({ firstName: "", lastName: "" });
  });
});

describe("detectDelimiter", () => {
  it("picks commas, semicolons and tabs", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
  });
});

// A conventional export with a proper header row.
const HEADED = [
  ["Debtor Report — August 2026"],
  [],
  ["First Name", "Surname", "Account No", "Cell", "Email", "Creditor", "Balance", "Days Overdue"],
  ["Thandi", "Nkosi", "EDG-5001", "0821234567", "t@example.co.za", "Edgars", "4850", "62"],
  ["Dawie", "Kruger", "EDG-5002", "+27835551234", "", "Edgars", "12400", "31"],
];

// A property arrears export: no usable header, columns identified by content.
// Layout: Prop, Building, Unit, Floor, Type, Door, Tenant, Balance, Contact
const HEADERLESS = [
  ["MPM01", "Hillbrow Heights", "204", "2", "Flat", "204", "NKOSI T", "15600.00", "0821234567"],
  ["MPM01", "Hillbrow Heights", "311", "3", "Flat", "311", "DLAMINI S", "7800.00", "0837654321"],
  ["MPM01", "Hillbrow Heights", "115", "1", "Flat", "115", "MOKOENA P", "23400.00", "0721112222"],
  ["MPM02", "Berea Court", "12", "1", "Duplex", "12", "VAN WYK A", "4200.00", "0609998888"],
  ["MPM02", "Berea Court", "18", "1", "Duplex", "18", "PILLAY R", "31000.00", "0834445555"],
];

describe("detectHeaderRow", () => {
  it("finds the header past a title and a blank line", () => {
    expect(detectHeaderRow(HEADED)).toBe(2);
  });

  it("reports none when the sheet has no labels", () => {
    expect(detectHeaderRow(HEADERLESS)).toBe(-1);
  });
});

describe("detectMapping — headed sheet", () => {
  const d = detectMapping(HEADED);

  it("starts the data after the header row", () => {
    expect(d.headerless).toBe(false);
    expect(d.dataStart).toBe(3);
  });

  it("maps every labelled column", () => {
    expect(d.mapping[0]).toBe("firstName");
    expect(d.mapping[1]).toBe("lastName");
    expect(d.mapping[2]).toBe("accountNumber");
    expect(d.mapping[3]).toBe("phone");
    expect(d.mapping[4]).toBe("email");
    expect(d.mapping[5]).toBe("creditorName");
    expect(d.mapping[6]).toBe("currentBalance");
    expect(d.mapping[7]).toBe("daysOverdue");
  });

  it("needs nothing else", () => {
    expect(d.missingRequired).toEqual([]);
  });
});

describe("detectMapping — headerless property export", () => {
  const d = detectMapping(HEADERLESS);

  it("treats every row as data", () => {
    expect(d.headerless).toBe(true);
    expect(d.dataStart).toBe(0);
  });

  it("finds the phone column by content", () => {
    expect(d.mapping[8]).toBe("phone");
  });

  it("picks the balance column, not the unit or floor numbers", () => {
    expect(d.mapping[7]).toBe("currentBalance");
  });

  it("tells the tenant name from the building name by repetition", () => {
    expect(d.mapping[6]).toBe("fullName");
    expect(d.mapping[1]).toBe("creditorName");
  });

  it("does not mistake the Type column for the creditor", () => {
    // "Flat"/"Duplex" repeats harder than the building name — length breaks the tie.
    expect(d.mapping[4]).not.toBe("creditorName");
  });

  it("has everything it needs to import", () => {
    expect(d.missingRequired).toEqual([]);
  });
});

describe("detectMapping — identifier columns are not money", () => {
  it("does not pick an unrecognised phone column as the balance", () => {
    // 8-digit cores never normalise to a phone, and as raw numbers they dwarf
    // every real balance — magnitude alone would make them the money column.
    const grid = [
      ["Building", "Unit", "Tenant", "Balance", "Contact"],
      ["Hillbrow Heights", "204", "NKOSI T", "15600", "82000001"],
      ["Hillbrow Heights", "311", "DLAMINI S", "7800", "82000002"],
      ["Berea Court", "12", "VAN WYK A", "4200", "82000003"],
    ];
    const d = detectMapping(grid);
    expect(d.mapping[3]).toBe("currentBalance");
    expect(d.mapping[4]).not.toBe("currentBalance");
  });

  it("still finds the balance when an ID number column is present", () => {
    const grid = [
      ["Tenant", "Cell", "ID Number", "Owing"],
      ["Thandi Nkosi", "0821234567", "8801015800087", "15600"],
      ["Sipho Dlamini", "0837654321", "9203125800081", "7800"],
    ];
    const d = detectMapping(grid);
    expect(d.mapping[3]).toBe("currentBalance");
    expect(d.mapping[1]).toBe("phone");
  });
});

describe("buildRows", () => {
  it("cleans a headed sheet into importable rows", () => {
    const { rows, skipped } = buildRows(HEADED, detectMapping(HEADED));
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      firstName: "Thandi",
      lastName: "Nkosi",
      accountNumber: "EDG-5001",
      phone: "+27821234567",
      creditorName: "Edgars",
      originalBalance: "4850",
      currentBalance: "4850",
      daysOverdue: "62",
      email: "t@example.co.za",
    });
    expect(rows[1].phone).toBe("+27835551234");
    expect(rows[1].email).toBeUndefined();
  });

  it("splits surname-and-initial names from a property export", () => {
    const { rows } = buildRows(HEADERLESS, detectMapping(HEADERLESS));
    expect(rows[0]).toMatchObject({
      firstName: "T",
      lastName: "Nkosi",
      phone: "+27821234567",
      creditorName: "Hillbrow Heights",
      originalBalance: "15600",
    });
    expect(rows[3]).toMatchObject({ lastName: "Van Wyk", creditorName: "Berea Court" });
  });

  it("builds a stable reference from building and unit when none is given", () => {
    const { rows } = buildRows(HEADERLESS, detectMapping(HEADERLESS));
    expect(rows[0].accountNumber).toBe("Hillbrow-Heights-204");
    expect(rows[4].accountNumber).toBe("Berea-Court-18");
    // References must be unique or importDebtors drops the row.
    expect(new Set(rows.map((r) => r.accountNumber)).size).toBe(rows.length);
  });

  it("rounds money to whole rand", () => {
    const grid = [
      ["Name", "Cell", "Balance"],
      ["Thandi Nkosi", "0821234567", "R 4 850,49"],
      ["Sipho Dlamini", "0837654321", "R 4 850,50"],
    ];
    const { rows } = buildRows(grid, detectMapping(grid));
    expect(rows[0].originalBalance).toBe("4850");
    expect(rows[1].originalBalance).toBe("4851");
  });

  it("skips rows with an unusable phone, no name or no balance", () => {
    const grid = [
      ["Name", "Cell", "Balance"],
      ["Thandi Nkosi", "0821234567", "4850"],
      ["Broken Number", "12345", "4850"],
      ["", "0837654321", "4850"],
      ["No Balance", "0721112222", "0"],
    ];
    const { rows, skipped } = buildRows(grid, detectMapping(grid));
    expect(rows).toHaveLength(1);
    expect(skipped).toHaveLength(3);
    // Row numbers are the ones the operator sees in Excel.
    expect(skipped[0]).toMatchObject({ row: 3 });
    expect(skipped[0].reason).toContain("12345");
    expect(skipped[1].reason).toContain("no name");
    expect(skipped[2].reason).toContain("balance");
  });

  it("falls back to a supplied creditor when the sheet has none", () => {
    const grid = [
      ["Name", "Cell", "Balance"],
      ["Thandi Nkosi", "0821234567", "4850"],
    ];
    const { rows } = buildRows(grid, detectMapping(grid), { defaultCreditor: "Mafadi" });
    expect(rows[0].creditorName).toBe("Mafadi");
  });

  it("keeps two rows that share a reference", () => {
    const grid = [
      ["Name", "Account", "Cell", "Balance"],
      ["Thandi Nkosi", "DUP-1", "0821234567", "4850"],
      ["Sipho Dlamini", "DUP-1", "0837654321", "7800"],
    ];
    const { rows, skipped } = buildRows(grid, detectMapping(grid));
    expect(skipped).toEqual([]);
    expect(rows).toHaveLength(2);
    expect(rows[0].accountNumber).not.toBe(rows[1].accountNumber);
  });
});
