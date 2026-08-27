import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { JOBIX_COLUMNS } from "./jobix-export";
import { commitBook, mapBook, parseAmount, parseSpreadsheet, previewBook } from "./book-import";

function workbookBuffer(rows: Record<string, string | number>[], headers?: string[]): Buffer {
  const sheet = XLSX.utils.json_to_sheet(rows, headers ? { header: headers } : undefined);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, sheet, "Sheet1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

/** A synthetic row in the exact shape of the real 72-column import workbook. */
function jobixRow(overrides: Record<string, string | number> = {}): Record<string, string | number> {
  const base = Object.fromEntries(JOBIX_COLUMNS.map((column) => [column, ""])) as Record<
    string,
    string | number
  >;
  return {
    ...base,
    Name: "Test Person",
    full_name: "Test Person",
    Phone: "+27825550100",
    phone: "+27825550100",
    Timezone: "Africa/Johannesburg",
    timezone: "Africa/Johannesburg",
    tenant_code: "TC-100",
    total_due: 4500,
    arrears_amount: 4500,
    building_name: "Test Building",
    batch: "Batch 2026-08-25",
    language: "English",
    call: "25AUG-TEST",
    ...overrides,
  };
}

describe("book import mapping", () => {
  it("recognises the 72-column Jobix workbook and maps its fields", () => {
    const sheet = parseSpreadsheet(
      workbookBuffer(
        [
          jobixRow(),
          jobixRow({ full_name: "Naledi van Wyk", Phone: "0825550101", phone: "0825550101", tenant_code: "TC-101", arrears_amount: "R 12,500", total_due: "R 12,500" }),
        ],
        [...JOBIX_COLUMNS],
      ),
      "batch.xlsx",
    );
    expect(sheet.headers).toHaveLength(72);

    const mapped = mapBook(sheet);
    expect(mapped.format).toBe("jobix");
    expect(mapped.rows[0].problem).toBeNull();
    expect(mapped.rows[0].data).toMatchObject({
      firstName: "Test",
      lastName: "Person",
      accountNumber: "TC-100",
      phone: "+27825550100",
      creditorName: "Test Building",
      originalBalance: 4500,
    });
    // Local-format phone and currency-formatted amount both normalise.
    expect(mapped.rows[1].data.phone).toBe("+27825550101");
    expect(mapped.rows[1].data.originalBalance).toBe(12500);
    expect(mapped.rows[1].data.lastName).toBe("van Wyk");
  });

  it("fuzzy-maps a generic client spreadsheet and reports the mapping used", () => {
    const sheet = parseSpreadsheet(
      workbookBuffer([
        { "Tenant Name": "Sipho Dube", "Cell No": "082 555 0102", "Amount Owing": "R7,200.50", "Body Corporate": "Oak Court", "Unit No": "B12" },
      ]),
      "client.xlsx",
    );
    const mapped = mapBook(sheet);
    expect(mapped.format).toBe("generic");
    expect(mapped.mapping).toMatchObject({
      fullName: "Tenant Name",
      phone: "Cell No",
      balance: "Amount Owing",
      creditor: "Body Corporate",
      unit: "Unit No",
    });
    expect(mapped.rows[0].problem).toBeNull();
    expect(mapped.rows[0].data).toMatchObject({
      firstName: "Sipho",
      lastName: "Dube",
      phone: "+27825550102",
      originalBalance: 7200.5,
      creditorName: "Oak Court",
      unit: "B12",
    });
  });

  it("names each row's problem instead of dropping it silently", () => {
    const sheet = parseSpreadsheet(
      workbookBuffer([
        { name: "", phone: "0825550103", balance: 100 },
        { name: "No Phone", phone: "", balance: 100 },
        { name: "Bad Phone", phone: "12", balance: 100 },
        { name: "Zero Balance", phone: "0825550104", balance: 0 },
      ]),
      "bad.xlsx",
    );
    const mapped = mapBook(sheet);
    expect(mapped.rows.map((row) => row.problem)).toEqual([
      "no name",
      "no phone number",
      'phone "12" is not a usable number',
      "amount owing is zero",
    ]);
  });
});

describe("format choice", () => {
  it("reads a file as the named format even when detection disagrees", () => {
    // Headers of the platform template, but the operator insists on generic:
    // the generic matcher recognises the same concepts by name, so the rows
    // still map — the point is that the choice is honoured and reported.
    const sheet = parseSpreadsheet(
      workbookBuffer([
        {
          firstName: "Ayanda",
          lastName: "Dube",
          accountNumber: "ACC-9",
          phone: "0825550199",
          creditorName: "Rosebank Mews",
          originalBalance: 3200,
        },
      ]),
      "book.xlsx",
    );

    expect(mapBook(sheet).format).toBe("simple");

    const forced = mapBook(sheet, "generic");
    expect(forced.format).toBe("generic");
    expect(forced.detectedFormat).toBe("simple");
    expect(forced.rows[0].problem).toBeNull();
  });

  it("reports the detected format alongside the one applied", () => {
    const sheet = parseSpreadsheet(
      workbookBuffer([jobixRow()], [...JOBIX_COLUMNS]),
      "batch.xlsx",
    );
    const mapped = mapBook(sheet, "auto");
    expect(mapped.format).toBe("jobix");
    expect(mapped.detectedFormat).toBe("jobix");
  });
});


describe("parseAmount", () => {
  it("reads the South African convention, where a comma is the decimal point", () => {
    // The bug this pins: stripping the comma turned R 7 450,00 into 745 000.
    expect(parseAmount("R 7 450,00")).toBe(7450);
    expect(parseAmount("R 1 250,50")).toBe(1250.5);
    expect(parseAmount("12 500,99")).toBe(12500.99);
    expect(parseAmount("R 0,50")).toBe(0.5);
  });

  it("reads the English convention, where a comma groups thousands", () => {
    expect(parseAmount("R 7,450.00")).toBe(7450);
    expect(parseAmount("$1,234,567.89")).toBe(1234567.89);
    expect(parseAmount("19,200.50")).toBe(19200.5);
  });

  it("treats a lone separator with three trailing digits as grouping", () => {
    expect(parseAmount("7,450")).toBe(7450);
    expect(parseAmount("12.500")).toBe(12500);
    expect(parseAmount("1 234 567")).toBe(1234567);
  });

  it("treats a lone separator with one or two trailing digits as a decimal", () => {
    expect(parseAmount("7450,5")).toBe(7450.5);
    expect(parseAmount("7450.55")).toBe(7450.55);
    expect(parseAmount("0,500")).toBe(0.5); // a bare zero can only be a fraction
  });

  it("handles plain numbers, negatives and nothing", () => {
    expect(parseAmount("4500")).toBe(4500);
    expect(parseAmount("-1 200,25")).toBe(-1200.25);
    expect(parseAmount("")).toBeNull();
    expect(parseAmount("No data available")).toBeNull();
    expect(parseAmount("R")).toBeNull();
  });
});

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("book import (integration)", () => {
  let orgId = "";
  let userId = "";

  beforeEach(async () => {
    await db.debtAccount.deleteMany();
    await db.debtor.deleteMany();
    await db.campaign.deleteMany();
    await db.auditLog.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();
    const org = await db.organization.create({ data: { name: "Import Co", slug: "import-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Ops", email: "ops@example.com", role: "admin" },
      })
    ).id;
  });

  it("previews without writing, then commits exactly the preview", async () => {
    const sheet = parseSpreadsheet(
      workbookBuffer(
        [
          jobixRow(),
          jobixRow({ full_name: "Second Person", Phone: "+27825550105", phone: "+27825550105", tenant_code: "TC-105" }),
          jobixRow({ full_name: "Dup Person", Phone: "+27825550105", phone: "+27825550105", tenant_code: "TC-106" }),
          jobixRow({ full_name: "Broken Person", Phone: "12", phone: "12", tenant_code: "TC-107" }),
        ],
        [...JOBIX_COLUMNS],
      ),
      "batch.xlsx",
    );

    const preview = await previewBook(orgId, sheet);
    expect(preview).toMatchObject({
      format: "jobix",
      totalRows: 4,
      creatable: 2,
      duplicateInFile: 1,
      alreadyOnPlatform: 0,
    });
    expect(preview.invalid).toHaveLength(1);
    expect(await db.debtor.count()).toBe(0); // preview wrote nothing

    const result = await commitBook(orgId, userId, sheet);
    expect(result.created).toBe(2);
    expect(result.skipped).toHaveLength(2);
    const debtors = await db.debtor.findMany({ include: { accounts: true } });
    expect(debtors).toHaveLength(2);
    expect(debtors.every((debtor) => debtor.accounts[0].currentBalance === 4500)).toBe(true);
  });

  it("gives the review grid one row per file row, each with the verdict commit will reach", async () => {
    await db.debtor.create({
      data: {
        organizationId: orgId,
        firstName: "Already",
        lastName: "Here",
        accountNumber: "OLD-9",
        phone: "+27825550105",
      },
    });

    const sheet = parseSpreadsheet(
      workbookBuffer(
        [
          jobixRow(),
          jobixRow({ full_name: "Already Here", Phone: "+27825550105", phone: "+27825550105", tenant_code: "TC-105" }),
          jobixRow({ full_name: "Dup Person", Phone: "+27825550100", phone: "+27825550100", tenant_code: "TC-106" }),
          jobixRow({ full_name: "Broken Person", Phone: "12", phone: "12", tenant_code: "TC-107" }),
        ],
        [...JOBIX_COLUMNS],
      ),
      "batch.xlsx",
    );

    const preview = await previewBook(orgId, sheet);

    expect(preview.grid.rows).toHaveLength(4);
    expect(preview.grid.rows.map((row) => row.status)).toEqual([
      "create",
      "existing",
      "duplicate",
      "invalid",
    ]);
    // Row numbers count the header line, so the operator can find the row in
    // the spreadsheet they uploaded.
    expect(preview.grid.rows.map((row) => row.row)).toEqual([2, 3, 4, 5]);
    // Every row that is not created says why.
    expect(preview.grid.rows[0].note).toBeNull();
    expect(preview.grid.rows[1].note).toMatch(/already on the platform/i);
    expect(preview.grid.rows[2].note).toMatch(/appears earlier/i);
    expect(preview.grid.rows[3].note).toMatch(/not a usable number/i);
    // The cells are the mapped values, not the raw file.
    expect(preview.grid.columns[0]).toBe("Name");
    expect(preview.grid.rows[0].cells[0]).toBe("Test Person");
    expect(preview.grid.rows[0].cells[3]).toBe(4500);
    expect(preview.grid.truncated).toBe(0);
    expect(await db.debtor.count()).toBe(1); // still nothing written
  });

  it("assigns existing debtors to the campaign instead of duplicating them", async () => {
    const campaign = await db.campaign.create({
      data: { organizationId: orgId, name: "Reload", status: "draft" },
    });
    await db.debtor.create({
      data: { organizationId: orgId, firstName: "Test", lastName: "Person", accountNumber: "OLD-1", phone: "0825550100" },
    });

    const sheet = parseSpreadsheet(workbookBuffer([jobixRow()], [...JOBIX_COLUMNS]), "batch.xlsx");
    const result = await commitBook(orgId, userId, sheet, campaign.id);
    expect(result).toMatchObject({ created: 0, assignedExisting: 1 });

    const debtor = await db.debtor.findFirstOrThrow();
    expect(debtor.campaignId).toBe(campaign.id);
    expect(debtor.accountNumber).toBe("OLD-1"); // ledger identity untouched
    expect(await db.debtor.count()).toBe(1);
  });

  it("suffixes an account-number collision rather than dropping the row", async () => {
    await db.debtor.create({
      data: { organizationId: orgId, firstName: "Other", lastName: "Person", accountNumber: "TC-100", phone: "+27825550999" },
    });
    const sheet = parseSpreadsheet(workbookBuffer([jobixRow()], [...JOBIX_COLUMNS]), "batch.xlsx");
    const result = await commitBook(orgId, userId, sheet);
    expect(result.created).toBe(1);
    const created = await db.debtor.findFirstOrThrow({ where: { phone: "+27825550100" } });
    expect(created.accountNumber).toBe("TC-100-1");
  });
});
