import { randomUUID } from "node:crypto";
import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { callColumnValue, loadFlowConfig } from "@/services/flow-config";
import { engineBatchStamp, evaluateEligibility } from "./rounds";

// ---------------------------------------------------------------------------
// The Jobix import workbook, written back out.
//
// The engine dials by API and never needs this file itself — but the manual
// workflow this platform replaces produced a 72-column import workbook, and
// operators still want that artifact: to upload by hand, to archive what was
// sent, or to run on a workspace this platform is not connected to. Same
// columns, same cleaning, generated from the campaign's book in one click.
//
// THE SUID IS MINTED HERE, FRESH, EVERY TIME.
//
// On an insert-started flow only an INSERT dials. Jobix upserts on the suid,
// so a file carrying the account's stable suid uploads as an UPDATE: the
// platform reports success, says "update", and no phone rings. That is not a
// Jobix quirk to work around later, it is the mechanism — so every row of
// every download gets an identifier that has never existed, and the person
// downloading never has to know any of this.
//
// Two shapes come out of here:
//
//   the book      — everyone, `call` left empty. For the archive, or for an
//                   operator who arms the rows themselves.
//   the redial    — only the accounts still owed a call, `call` already
//                   carrying the flow flag. Upload it and those phones ring.
//                   This is the list that used to be built by hand.
// ---------------------------------------------------------------------------

// The 72-column list lives in one place — the debtor-path exporter — and is
// shared here so the two writers can never drift apart.
import { JOBIX_COLUMNS as IMPORT_COLUMNS } from "@/services/jobix-export";

const PHONE_COLUMNS = new Set(["Phone", "phone"]);

function batchLabel(campaignName: string, now = new Date(), suffix?: string): string {
  const stem = campaignName
    .toUpperCase()
    .replace(/[^A-Z0-9]+/g, "_")
    .replace(/^_+|_+$/g, "")
    .slice(0, 24) || "BOOK";
  return [stem, engineBatchStamp(now), suffix].filter(Boolean).join("_");
}

export type ImportFileOptions = {
  /**
   * "book" is everyone; "redial" is only those still owed a call, decided by
   * the same rule the next round uses — so the file and the engine can never
   * disagree about who is finished.
   */
  list?: "book" | "redial";
  /**
   * Fill the `call` column with the configured flow flag. An armed row on an
   * insert-started flow rings as it lands, which is the point of the redial
   * file and a hazard for anything else — so it is never the default.
   */
  armed?: boolean;
};

/** The campaign's book as a 72-column Jobix import workbook (.xlsx buffer). */
export async function jobixImportWorkbook(
  organizationId: string,
  campaignId: string,
  options: ImportFileOptions = {},
): Promise<{ buffer: Buffer; filename: string; accounts: number; armed: boolean }> {
  const campaign = await db.campaign.findFirstOrThrow({
    where: { id: campaignId, organizationId },
  });
  const all = await db.engineAccount.findMany({
    where: { campaignId, organizationId },
    orderBy: { totalDue: "desc" },
  });
  if (all.length === 0) {
    throw new Error("The book is empty — load it before downloading the import file.");
  }

  const wantRedial = options.list === "redial";
  const accounts = wantRedial ? evaluateEligibility(campaign, all).eligible : all;
  if (accounts.length === 0) {
    throw new Error(
      "Nobody is owed another call — every account is resolved, out of attempts, or has no usable number.",
    );
  }

  // The flag the flow's entry filter matches. Resolved through the shared
  // config so this file and the in-app dialler always write the same value.
  let callFlag: string | undefined;
  if (options.armed) {
    callFlag = callColumnValue(await loadFlowConfig(organizationId), undefined);
    if (!callFlag) {
      throw new Error(
        "No call flag is configured, so an armed file would not match the flow. Set it under Settings first.",
      );
    }
  }

  const batch = batchLabel(campaign.name, undefined, wantRedial ? "REDIAL" : undefined);
  const rows = accounts.map((account) => {
    const row: Record<string, string | number | null> = {};
    for (const column of IMPORT_COLUMNS) row[column] = null;
    // Never the account's own suid: that is a known identifier, and a known
    // identifier is an update, and an update does not dial.
    const fresh = randomUUID();
    row["SUID"] = fresh;
    row["suid"] = fresh;
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
    // Armed only when asked for. `batch` stays the attribution key either way:
    // the flow never writes to it, so results still come back to this run.
    if (callFlag) row["call"] = callFlag;
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
  return {
    buffer,
    filename: `Jobix_${wantRedial ? "Redial" : "Import"}_${batch}.xlsx`,
    accounts: accounts.length,
    armed: Boolean(callFlag),
  };
}
