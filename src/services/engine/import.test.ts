import { describe, expect, it } from "vitest";
import {
  cleanAmount,
  cleanName,
  cleanPhone,
  dedupeByPhone,
  detectFormat,
  findHeaderRow,
  parseSheet,
  type ParsedRow,
} from "./import";

// ---------------------------------------------------------------------------
// Every case here is from the spec, and most of the spec's cases are bugs that
// already happened on a real book. If one of these breaks, a real tenant gets
// mis-dialled, mis-named or mis-quoted.
// ---------------------------------------------------------------------------

describe("finding the header", () => {
  it("is not assumed to be row 0", () => {
    const rows = [
      ["ARREARS AS AT 31 AUGUST"],
      [],
      ["Building", "Unit", "Tenant", "Balance", "Contact"],
      ["Philberta Court", "U217", "MR S NDULI", "1086", "0825104242"],
    ];
    expect(findHeaderRow(rows)).toBe(2);
  });

  it("gives up beyond row 4 rather than guessing", () => {
    const rows = [[], [], [], [], ["Building", "Unit", "Tenant", "Balance", "Contact"]];
    expect(findHeaderRow(rows)).toBeNull();
  });
});

describe("format detection", () => {
  it("5 columns is G", () => {
    expect(detectFormat(["Building", "Unit", "Tenant", "Balance", "Contact"])).toBe("G");
  });
  it("6 columns splits on the Prop header", () => {
    expect(detectFormat(["Prop", "Building", "Unit", "Tenant", "Balance", "Contact"])).toBe("I");
    expect(detectFormat(["Building", "Unit", "PFl", "Tenant", "Balance", "Contact"])).toBe("H");
  });
  it("8 columns splits on PFl", () => {
    expect(detectFormat(["Prop", "Building", "Unit", "PFl", "Type", "Tenant", "Balance", "Contact"])).toBe("D");
    expect(detectFormat(["Prop", "Building", "Unit", "Type", "Door No", "Tenant", "Balance", "Contact"])).toBe("C");
  });
  it("10 columns is A unless Cc/Let is present — the Invest-column bug", () => {
    // A real file with a trailing "Invest" column was misread as F and the
    // building name landed in the unit field.
    expect(
      detectFormat(["Prop", "Building", "Unit", "PFl", "Type", "Door No", "Tenant", "Balance", "Contact", "Invest"]),
    ).toBe("A");
    expect(
      detectFormat(["Prop", "Cc", "Let", "Building", "Unit", "Door No", "Tenant", "Balance", "Contact", "Unit Ref"]),
    ).toBe("F");
  });
  it("11+ columns needs Cc/Let to be E; otherwise it refuses", () => {
    expect(
      detectFormat(["Prop", "Cc", "Let", "Building", "Unit", "Type", "Door No", "Tenant", "Balance", "Contact", "Unit Ref"]),
    ).toBe("E");
    expect(detectFormat(["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", "k"])).toBeNull();
  });
  it("trailing empty header cells are padding, not columns", () => {
    expect(detectFormat(["Building", "Unit", "Tenant", "Balance", "Contact", "", ""])).toBe("G");
  });
});

describe("name cleaning", () => {
  it("strips titles as whole words in any case", () => {
    expect(cleanName("MR S NDULI")?.fullName).toBe("S Nduli");
    expect(cleanName("mrs Thandi Mokoena")?.fullName).toBe("Thandi Mokoena");
    expect(cleanName("Dr. Sipho Dlamini")?.fullName).toBe("Sipho Dlamini");
  });
  it("does not strip title letters out of real names", () => {
    // M is a title only as a whole word — "Mandla" keeps its M.
    expect(cleanName("Mandla Modise")?.fullName).toBe("Mandla Modise");
  });
  it("cuts everything from the first * or (", () => {
    expect(cleanName("Simphiwe Nduli *HANDED OVER")?.fullName).toBe("Simphiwe Nduli");
    expect(cleanName("Sipho Dlamini (Unit 12)")?.fullName).toBe("Sipho Dlamini");
  });
  it("flips comma surname-first, but never joint accounts", () => {
    expect(cleanName("Nduli, Simphiwe")?.fullName).toBe("Simphiwe Nduli");
    expect(cleanName("Nduli, S & Khumalo, B")?.fullName).toBe("Nduli, S & Khumalo, B");
  });
  it("title-cases ALL CAPS and collapses whitespace", () => {
    expect(cleanName("SIMPHIWE   VAN DER MERWE")?.fullName).toBe("Simphiwe Van Der Merwe");
  });
  it("skips a row whose name cleans to nothing", () => {
    expect(cleanName("MR *")).toBeNull();
    expect(cleanName("   ")).toBeNull();
  });
  it("greeting_name drops trailing initials and joint partners", () => {
    expect(cleanName("Khumalo B T")?.greetingName).toBe("Khumalo");
    expect(cleanName("Sipho Dlamini / Jane Dlamini")?.greetingName).toBe("Sipho Dlamini");
    expect(cleanName("Thandi Mokoena & Others")?.greetingName).toBe("Thandi Mokoena");
  });
  it("greeting_name falls back to the full name rather than empty", () => {
    const name = cleanName("B T");
    expect(name?.greetingName).toBe(name?.fullName);
  });
});

describe("phone normalisation", () => {
  it("handles the four corruption shapes", () => {
    expect(cleanPhone("27787858045.0")).toBe("+27787858045"); // Excel float
    expect(cleanPhone("821234567")).toBe("+27821234567"); // eaten leading zero
    expect(cleanPhone("27821234567")).toBe("+27821234567"); // bare country code
    expect(cleanPhone("082 123 4567")).toBe("+27821234567"); // spaces and zero
  });
  it("takes the first number when a cell holds several", () => {
    expect(cleanPhone("0821234567, 0837654321")).toBe("+27821234567");
  });
  it("strips punctuation", () => {
    expect(cleanPhone("(082) 123-4567")).toBe("+27821234567");
  });
  it("returns null for too few digits — the account stays, undialable", () => {
    expect(cleanPhone("12345678")).toBeNull();
    expect(cleanPhone("")).toBeNull();
    expect(cleanPhone("N/A")).toBeNull();
  });
  it("every produced value matches ^\\+27\\d{9}$", () => {
    for (const raw of ["27787858045.0", "821234567", "0825104242", "27821234567"]) {
      expect(cleanPhone(raw)).toMatch(/^\+27\d{9}$/);
    }
  });
});

describe("amounts", () => {
  it("rounds to whole rands", () => {
    expect(cleanAmount("1086.49")).toBe(1086);
    expect(cleanAmount("R 12,345.60")).toBe(12346);
  });
  it("skips zero and negative balances", () => {
    expect(cleanAmount("0")).toBeNull();
    expect(cleanAmount("-500")).toBeNull();
  });
});

describe("dedupe to one account per phone", () => {
  const row = (over: Partial<ParsedRow>): ParsedRow => ({
    fullName: "Sipho Dlamini",
    greetingName: "Sipho Dlamini",
    phone: "+27821234567",
    balance: 1000,
    unitNumber: "U1",
    buildingName: "Philberta",
    tenantCode: "T1",
    sourceFile: "book.xlsx",
    sourceRow: 2,
    ...over,
  });

  it("collapses a multi-unit tenant into one person who owes the sum", () => {
    const accounts = dedupeByPhone([
      row({ unitNumber: "U1", balance: 1000 }),
      row({ unitNumber: "P12", balance: 300, sourceRow: 3 }),
      row({ unitNumber: "U9", balance: 5000, sourceRow: 4 }),
    ]);
    expect(accounts).toHaveLength(1);
    expect(accounts[0]).toMatchObject({
      totalDue: 6300,
      unitsHeld: 3,
      multiUnit: true,
      unitNumber: "U9", // the largest-balance unit describes them
      quotedUnitDue: 5000,
    });
  });

  it("keeps phoneless rows individual — nothing to collapse them on", () => {
    const accounts = dedupeByPhone([
      row({ phone: null, sourceRow: 2 }),
      row({ phone: null, sourceRow: 3 }),
    ]);
    expect(accounts).toHaveLength(2);
  });

  it("does not merge different phones", () => {
    const accounts = dedupeByPhone([row({}), row({ phone: "+27837654321" })]);
    expect(accounts).toHaveLength(2);
  });
});

describe("parsing a sheet end to end", () => {
  it("reads a format-G sheet below its title row", () => {
    const rows = [
      ["ARREARS"],
      ["Building", "Unit", "Tenant", "Balance", "Contact"],
      ["Philberta", "U217", "MR S NDULI *HANDED", "1086.49", "0825104242"],
      ["Philberta", "U218", "", "500", "0821111111"], // no name → skipped
      ["Philberta", "U219", "Thandi Mokoena", "0", "0822222222"], // zero → skipped
      ["Philberta", "U220", "Vusi Dlamini", "750", "12"], // bad phone → kept, no phone
    ];
    const parsed = parseSheet(
      rows,
      { tenant: 2, bal: 3, phone: 4, unit: 1, building: 0, code: null },
      "book.xlsx",
      1,
      "G",
    );
    expect(parsed.rows).toHaveLength(2);
    expect(parsed.rows[0]).toMatchObject({
      fullName: "S Nduli",
      phone: "+27825104242",
      balance: 1086,
      unitNumber: "U217",
      buildingName: "Philberta",
      sourceRow: 3,
    });
    expect(parsed.rows[1].phone).toBeNull();
    expect(parsed.skipped.map((s) => s.reason)).toEqual([
      "no name after cleaning",
      "zero, negative or unreadable balance",
    ]);
  });
});
