import { beforeEach, describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { JOBIX_COLUMNS } from "@/services/jobix-export";
import { importIntoEngine } from "./import";
import { jobixImportWorkbook } from "./import-file";

const url = process.env.DATABASE_URL ?? "";
const scratch = process.env.TEST_DATABASE_RESET === "1" && /test|scratch|tmp/i.test(url);

describe.skipIf(!scratch)("engine import workbook", () => {
  let orgId = "";
  let campaignId = "";
  let userId = "";

  /** Two accounts, so a filter has something to leave behind. */
  async function seedTwo() {
    await importIntoEngine(orgId, campaignId, userId, [
      {
        format: "G",
        skipped: [],
        rows: [
          {
            fullName: "Thandi Dlamini",
            greetingName: "Thandi",
            phone: "+27825550100",
            balance: 9000,
            unitNumber: "U1",
            buildingName: "Test Court",
            tenantCode: "T1",
            sourceFile: "seed.xlsx",
            sourceRow: 2,
          },
          {
            fullName: "Sipho Khumalo",
            greetingName: "Sipho",
            phone: "+27825550101",
            balance: 4000,
            unitNumber: "U2",
            buildingName: "Test Court",
            tenantCode: "T2",
            sourceFile: "seed.xlsx",
            sourceRow: 3,
          },
        ],
      },
    ]);
  }

  beforeEach(async () => {
    await db.engineAttempt.deleteMany();
    await db.engineBatch.deleteMany();
    await db.engineAccount.deleteMany();
    await db.integrationSettings.deleteMany();
    await db.campaign.deleteMany();
    await db.user.deleteMany();
    await db.organization.deleteMany();

    const org = await db.organization.create({ data: { name: "Export Co", slug: "export-co" } });
    orgId = org.id;
    userId = (
      await db.user.create({
        data: { organizationId: orgId, name: "Op", email: "op@export.test", role: "admin" },
      })
    ).id;
    campaignId = (
      await db.campaign.create({
        data: {
          organizationId: orgId,
          name: "Sept Arrears",
          callingHoursStart: "08:00",
          callingHoursEnd: "12:00",
        },
      })
    ).id;
    // The flag the flow's entry filter matches, as an operator would set it.
    await db.integrationSettings.create({
      data: { organizationId: orgId, provider: "jobix", callFlag: "READY" },
    });
  });

  it("writes the book as the 72-column workbook, phones as text, call unarmed", async () => {
    await importIntoEngine(orgId, campaignId, userId, [
      {
        format: "G",
        skipped: [],
        rows: [
          {
            fullName: "Thandi Dlamini",
            greetingName: "Thandi",
            phone: "+27825550100",
            balance: 9000,
            unitNumber: "U1",
            buildingName: "Test Court",
            tenantCode: "T1",
            sourceFile: "seed.xlsx",
            sourceRow: 2,
          },
          {
            fullName: "No Number Person",
            greetingName: "No Number Person",
            phone: null,
            balance: 500,
            unitNumber: "U2",
            buildingName: "Test Court",
            tenantCode: "T2",
            sourceFile: "seed.xlsx",
            sourceRow: 3,
          },
        ],
      },
    ]);

    const { buffer, filename, accounts } = await jobixImportWorkbook(orgId, campaignId);
    expect(accounts).toBe(2);
    expect(filename).toMatch(/^Jobix_Import_SEPT_ARREARS_\d{2}[A-Z]{3}\d{4}\.xlsx$/);

    const wb = XLSX.read(buffer, { type: "buffer" });
    const sheet = wb.Sheets[wb.SheetNames[0]];
    const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, { defval: null });
    // The header is the workbook's own 72 columns, in order.
    const range = XLSX.utils.decode_range(sheet["!ref"]!);
    const headers: string[] = [];
    for (let c = range.s.c; c <= range.e.c; c += 1) {
      headers.push(String(sheet[XLSX.utils.encode_cell({ r: 0, c })]?.v ?? ""));
    }
    expect(headers).toEqual([...JOBIX_COLUMNS]);

    // Largest balance first, phone kept as text, both name spellings filled.
    const first = table[0];
    expect(first.full_name).toBe("Thandi Dlamini");
    expect(first.Name).toBe("Thandi Dlamini");
    expect(first.phone).toBe("+27825550100");
    expect(first.total_due).toBe(9000);
    expect(first.arrears_amount).toBe(9000);
    expect(first.timezone).toBe("Africa/Johannesburg");
    const phoneCell = sheet[XLSX.utils.encode_cell({ r: 1, c: JOBIX_COLUMNS.indexOf("phone") })];
    expect(phoneCell.t).toBe("s");

    // A phoneless account still exports — contact repair happens in Excel too.
    expect(table[1].full_name).toBe("No Number Person");
    expect(table[1].phone).toBeNull();

    // Never armed: dialling is the platform's decision, not the file's.
    for (const row of table) expect(row.call).toBeNull();
  });

  it("refuses an empty book", async () => {
    await expect(jobixImportWorkbook(orgId, campaignId)).rejects.toThrow(/book is empty/i);
  });

  it("mints a suid nobody has seen, every row and every download", async () => {
    await seedTwo();
    const read = async (opts?: Parameters<typeof jobixImportWorkbook>[2]) => {
      const { buffer } = await jobixImportWorkbook(orgId, campaignId, opts);
      const wb = XLSX.read(buffer, { type: "buffer" });
      return XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
        defval: null,
      });
    };

    const first = await read();
    const second = await read();
    const suids = first.map((r) => String(r.SUID));

    // Unique within the file...
    expect(new Set(suids).size).toBe(suids.length);
    // ...and never the account's own stored suid, which Jobix already knows —
    // sending a known one is an update, and an update does not dial.
    const stored = (await db.engineAccount.findMany({ where: { campaignId } })).map((a) => a.suid);
    expect(suids.some((s) => stored.includes(s))).toBe(false);
    // ...and different again next download, so a second upload still inserts.
    expect(second.map((r) => String(r.SUID))).not.toEqual(suids);
    // Both spellings of the column carry it.
    expect(first.every((r) => r.suid === r.SUID)).toBe(true);
  });

  it("exports only the accounts still owed a call, and arms them", async () => {
    await seedTwo();
    const accounts = await db.engineAccount.findMany({
      where: { campaignId },
      orderBy: { totalDue: "desc" },
    });
    // One is settled, so the redial list is the other one alone.
    await db.engineAccount.update({
      where: { id: accounts[0].id },
      data: { state: "resolved", outcome: "PTP" },
    });

    const { buffer, accounts: n, armed, filename } = await jobixImportWorkbook(orgId, campaignId, {
      list: "redial",
      armed: true,
    });
    expect(n).toBe(1);
    expect(armed).toBe(true);
    expect(filename).toMatch(/^Jobix_Redial_.*_REDIAL\.xlsx$/);

    const wb = XLSX.read(buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
      defval: null,
    });
    expect(rows).toHaveLength(1);
    expect(rows[0].full_name).toBe(accounts[1].fullName);
    // Armed with the configured flag, which is what the flow's filter matches.
    expect(rows[0].call).toBe("READY");
  });

  it("leaves the book unarmed, so a plain download cannot ring anyone", async () => {
    await seedTwo();
    const { buffer, armed } = await jobixImportWorkbook(orgId, campaignId);
    expect(armed).toBe(false);
    const wb = XLSX.read(buffer, { type: "buffer" });
    const rows = XLSX.utils.sheet_to_json<Record<string, unknown>>(wb.Sheets[wb.SheetNames[0]], {
      defval: null,
    });
    expect(rows.every((r) => r.call === null)).toBe(true);
  });

  it("refuses a redial list when nobody is owed a call", async () => {
    await seedTwo();
    await db.engineAccount.updateMany({
      where: { campaignId },
      data: { state: "resolved", outcome: "PAID" },
    });
    await expect(
      jobixImportWorkbook(orgId, campaignId, { list: "redial" }),
    ).rejects.toThrow(/Nobody is owed another call/i);
  });
});
