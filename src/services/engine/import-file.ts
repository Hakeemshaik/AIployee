import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { engineBatchStamp } from "./rounds";

// ---------------------------------------------------------------------------
// The Jobix import workbook, written back out.
//
// The engine dials by API and never needs this file itself — but the manual
// workflow this platform replaces produced a 72-column import workbook, and
// operators still want that artifact: to upload by hand, to archive what was
// sent, or to run on a workspace this platform is not connected to. Same
// columns, same cleaning, generated from the campaign's book in one click.
// ---------------------------------------------------------------------------

// The 72-column list lives in one place — the debtor-path exporter — and is
// shared here so the two writers can never drift apart.
import { JOBIX_COLUMNS as IMPORT_COLUMNS } from "@/services/jobix-export";

const PHONE_COLUMNS = new Set(["Phone", "phone"]);

function batchLabel(campaignName: string, now = new Date()): string {
  const stem = campaignName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "BOOK";
  return `${stem}_${engineBatchStamp(now)}`;
}

/** The campaign's book as a 72-column Jobix import workbook (.xlsx buffer). */
export async function jobixImportWorkbook(
  organizationId: string,
  campaignId: string,
): Promise<{ buffer: Buffer; filename: string; accounts: number }> {
  const campaign = await db.campaign.findFirstOrThrow({
    where: { id: campaignId, organizationId },
    select: { name: true },
  });
  const accounts = await db.engineAccount.findMany({
    where: { campaignId, organizationId },
    orderBy: { totalDue: "desc" },
  });
  if (accounts.length === 0) {
    throw new Error("The book is empty — load it before downloading the import file.");
  }

  const batch = batchLabel(campaign.name);
  const rows = accounts.map((account) => {
    const row: Record<string, string | number | null> = {};
    for (const column of IMPORT_COLUMNS) row[column] = null;
    row["SUID"] = account.suid;
    row["suid"] = account.suid;
    row["Name"] = account.fullName;
    row["name"] = account.fullName;
    row["full_name"] = account.fullName;
    row["Phone"] = account.phone;
    row["phone"] = account.phone;
    row["Email"] = account.email;
    row["email"] = account.email;
    row["Timezone"] = "Africa/Johannesburg";
    row["timezone"] = "Africa/Johannesburg";
    row["unit_number"] = account.unitNumber;
    row["main_unit_no"] = account.unitNumber;
    row["main_unit_no_"] = account.unitNumber;
    row["total_due"] = account.totalDue;
    row["arrears_amount"] = account.totalDue;
    row["tenant_code"] = account.tenantCode;
    row["building_name"] = account.buildingName;
    row["batch"] = batch;
    row["language"] = "English";
    // "call" stays empty on purpose: an armed import dials the moment a
    // trigger fires. Arming is a decision the operator makes on the platform.
    return row;
  });

  const sheet = XLSX.utils.json_to_sheet(rows, { header: [...IMPORT_COLUMNS] });

  // Phones must survive Excel as text — a numeric cell drops the "+" and the
  // leading digits with it.
  const range = XLSX.utils.decode_range(sheet["!ref"]!);
  for (let c = range.s.c; c <= range.e.c; c += 1) {
    const header = IMPORT_COLUMNS[c];
    if (!PHONE_COLUMNS.has(header)) continue;
    for (let r = range.s.r + 1; r <= range.e.r; r += 1) {
      const cell = sheet[XLSX.utils.encode_cell({ r, c })];
      if (cell && cell.v !== null && cell.v !== undefined && cell.v !== "") {
        cell.t = "s";
        cell.z = "@";
        cell.v = String(cell.v);
      }
    }
  }

  const workbook = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook, sheet, "Sheet1");
  const buffer = XLSX.write(workbook, { type: "buffer", bookType: "xlsx" }) as Buffer;
  return { buffer, filename: `Jobix_Import_${batch}.xlsx`, accounts: accounts.length };
}
