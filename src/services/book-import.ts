import * as XLSX from "xlsx";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { normalizePhone } from "@/services/debtors";

// ---------------------------------------------------------------------------
// Book file import.
//
// Clients hand over their books in whatever shape they have — the 72-column
// Jobix import workbook, an agency spreadsheet, a bare CSV. This module takes
// the file as uploaded (xlsx or csv), works out which shape it is, maps it
// onto the platform's debtor model, and validates every row BEFORE anything
// is written: the operator sees exactly what will be created, what already
// exists, and what is unusable and why — the same honesty rule as the
// dialling exclusions.
//
// Format detection, in order:
//   1. "jobix"   — the 72-column import workbook (matched on its distinctive
//                  headers: full_name + tenant_code + arrears_amount).
//   2. "simple"  — the platform's own template (firstName/lastName/...).
//   3. "generic" — anything else: headers are fuzzy-matched per concept, and
//                  the mapping used is reported so a wrong guess is visible.
// ---------------------------------------------------------------------------

export type BookRow = {
  firstName: string;
  lastName: string;
  accountNumber: string;
  phone: string;
  email: string | null;
  city: string | null;
  creditorName: string;
  originalBalance: number;
  unit: string | null;
};

export type RowIssue = { row: number; problem: string };

export type BookPreview = {
  format: "jobix" | "simple" | "generic";
  /** Which source column each concept was read from — the operator's check
   *  that a generic mapping guessed right. */
  mapping: Record<string, string>;
  totalRows: number;
  creatable: number;
  creatableValue: number;
  alreadyOnPlatform: number;
  duplicateInFile: number;
  invalid: RowIssue[];
  /** First rows that will be created, for a visual sanity check. */
  sample: { name: string; phone: string; balance: number; creditor: string }[];
};

const norm = (header: string) => header.toLowerCase().replace(/[^a-z0-9]/g, "");

/** Concept → recognised header spellings, most specific first. */
const GENERIC_HEADERS: Record<string, string[]> = {
  fullName: ["fullname", "name", "tenantname", "customername", "debtorname", "accountholder"],
  firstName: ["firstname", "first"],
  lastName: ["lastname", "surname", "last"],
  phone: ["phone", "phonenumber", "cell", "cellphone", "cellno", "mobile", "mobilenumber", "contactnumber", "tel", "telephone"],
  email: ["email", "emailaddress"],
  account: ["accountnumber", "account", "tenantcode", "reference", "accountref", "unitreference", "leaseref"],
  balance: ["arrearsamount", "arrears", "totaldue", "amountdue", "balance", "currentbalance", "outstanding", "amountowing", "totalbalance"],
  creditor: ["buildingname", "building", "creditorname", "creditor", "bodycorporate", "bodycorporatename", "complex", "client"],
  unit: ["unitnumber", "unit", "unitno", "mainunitno", "doorno"],
  city: ["city", "town", "location", "suburb"],
};

function pickColumn(headers: string[], concept: string): string | null {
  const wanted = GENERIC_HEADERS[concept] ?? [];
  const normalised = headers.map(norm);
  for (const candidate of wanted) {
    const index = normalised.indexOf(candidate);
    if (index !== -1) return headers[index];
  }
  return null;
}

export type ParsedSheet = { headers: string[]; rows: Record<string, string>[] };

/** Parse an uploaded workbook or CSV into header-keyed string rows. */
export function parseSpreadsheet(buffer: Buffer, filename: string): ParsedSheet {
  const workbook = XLSX.read(buffer, {
    type: "buffer",
    // Values only: formulas and styles are irrelevant and cost memory.
    cellFormula: false,
    cellHTML: false,
  });
  const sheetName = workbook.SheetNames[0];
  if (!sheetName) throw new Error("The file contains no sheets.");
  const sheet = workbook.Sheets[sheetName];
  const table = XLSX.utils.sheet_to_json<Record<string, unknown>>(sheet, {
    defval: "",
    raw: false,
  });
  if (table.length === 0) throw new Error(`The file has no data rows (sheet "${sheetName}").`);
  const headers = Object.keys(table[0]);
  const rows = table.map((row) =>
    Object.fromEntries(Object.entries(row).map(([key, value]) => [key, String(value ?? "").trim()])),
  );
  void filename;
  return { headers, rows };
}

function splitFullName(full: string): { firstName: string; lastName: string } {
  const cleaned = full.trim().replace(/\s+/g, " ");
  const parts = cleaned.split(" ");
  if (parts.length === 1) return { firstName: parts[0], lastName: "—" };
  return { firstName: parts[0], lastName: parts.slice(1).join(" ") };
}

function parseAmount(raw: string): number | null {
  const cleaned = raw.replace(/[R\s,]/gi, "").replace(/[^\d.-]/g, "");
  if (!cleaned) return null;
  const value = Number(cleaned);
  return Number.isFinite(value) ? Math.round(value * 100) / 100 : null;
}

export type MappedBook = {
  format: BookPreview["format"];
  mapping: Record<string, string>;
  rows: { row: number; data: Partial<BookRow>; problem: string | null }[];
};

export function mapBook(sheet: ParsedSheet): MappedBook {
  const normalised = sheet.headers.map(norm);
  const has = (header: string) => normalised.includes(norm(header));

  const isJobix = has("full_name") && has("tenant_code") && (has("arrears_amount") || has("total_due"));
  const isSimple = has("firstName") && has("lastName") && has("accountNumber") && has("creditorName");

  const format: BookPreview["format"] = isJobix ? "jobix" : isSimple ? "simple" : "generic";

  const col = (concept: string): string | null => {
    if (format === "jobix") {
      const jobixMap: Record<string, string[]> = {
        fullName: ["full_name", "Name", "name"],
        phone: ["Phone", "phone"],
        email: ["Email", "email"],
        account: ["tenant_code"],
        balance: ["arrears_amount", "total_due"],
        creditor: ["building_name"],
        unit: ["unit_number", "main_unit_no"],
        city: ["location"],
      };
      for (const candidate of jobixMap[concept] ?? []) {
        const index = normalised.indexOf(norm(candidate));
        if (index !== -1) return sheet.headers[index];
      }
      return null;
    }
    if (format === "simple") {
      const simpleMap: Record<string, string> = {
        firstName: "firstName", lastName: "lastName", phone: "phone", email: "email",
        account: "accountNumber", balance: "originalBalance", creditor: "creditorName", city: "city",
      };
      const index = normalised.indexOf(norm(simpleMap[concept] ?? ""));
      return index === -1 ? null : sheet.headers[index];
    }
    return pickColumn(sheet.headers, concept);
  };

  const columns = {
    fullName: col("fullName"),
    firstName: col("firstName"),
    lastName: col("lastName"),
    phone: col("phone"),
    email: col("email"),
    account: col("account"),
    balance: col("balance"),
    creditor: col("creditor"),
    unit: col("unit"),
    city: col("city"),
  };

  const mapping: Record<string, string> = {};
  for (const [concept, header] of Object.entries(columns)) {
    if (header) mapping[concept] = header;
  }

  const rows: MappedBook["rows"] = sheet.rows.map((raw, index) => {
    const rowNumber = index + 2; // 1-based plus the header line
    const get = (header: string | null) => (header ? (raw[header] ?? "").trim() : "");

    let firstName = get(columns.firstName);
    let lastName = get(columns.lastName);
    if (!firstName && columns.fullName) {
      const split = splitFullName(get(columns.fullName));
      firstName = split.firstName;
      lastName = split.lastName;
    }
    const phoneRaw = get(columns.phone);
    const phone = phoneRaw ? normalizePhone(phoneRaw) : null;
    const balance = parseAmount(get(columns.balance));
    const account = get(columns.account);

    let problem: string | null = null;
    if (!firstName) problem = "no name";
    else if (!phoneRaw) problem = "no phone number";
    else if (!phone) problem = `phone "${phoneRaw}" is not a usable number`;
    else if (balance === null) problem = "no amount owing";
    else if (balance <= 0) problem = "amount owing is zero";

    return {
      row: rowNumber,
      problem,
      data: {
        firstName,
        lastName: lastName || "—",
        accountNumber: account || (phone ? `IMP-${phone.slice(-9)}` : ""),
        phone: phone ?? "",
        email: get(columns.email) || null,
        city: get(columns.city) || null,
        creditorName: get(columns.creditor) || "Imported book",
        originalBalance: balance ?? 0,
        unit: get(columns.unit) || null,
      },
    };
  });

  return { format, mapping, rows };
}

const phoneKey = (phone: string) => phone.replace(/[^\d]/g, "").slice(-9);

export async function previewBook(
  organizationId: string,
  sheet: ParsedSheet,
): Promise<BookPreview> {
  const mapped = mapBook(sheet);
  const existing = await db.debtor.findMany({
    where: { organizationId },
    select: { phone: true },
  });
  const existingPhones = new Set(existing.map((d) => phoneKey(d.phone)));

  const seenInFile = new Set<string>();
  let creatable = 0;
  let creatableValue = 0;
  let alreadyOnPlatform = 0;
  let duplicateInFile = 0;
  const invalid: RowIssue[] = [];
  const sample: BookPreview["sample"] = [];

  for (const entry of mapped.rows) {
    if (entry.problem) {
      invalid.push({ row: entry.row, problem: entry.problem });
      continue;
    }
    const key = phoneKey(entry.data.phone!);
    if (seenInFile.has(key)) {
      duplicateInFile += 1;
      continue;
    }
    seenInFile.add(key);
    if (existingPhones.has(key)) {
      alreadyOnPlatform += 1;
      continue;
    }
    creatable += 1;
    creatableValue += entry.data.originalBalance!;
    if (sample.length < 5) {
      sample.push({
        name: `${entry.data.firstName} ${entry.data.lastName}`,
        phone: entry.data.phone!,
        balance: entry.data.originalBalance!,
        creditor: entry.data.creditorName!,
      });
    }
  }

  return {
    format: mapped.format,
    mapping: mapped.mapping,
    totalRows: mapped.rows.length,
    creatable,
    creatableValue,
    alreadyOnPlatform,
    duplicateInFile,
    invalid: invalid.slice(0, 100),
    sample,
  };
}

export type BookCommitResult = {
  created: number;
  assignedExisting: number;
  skipped: RowIssue[];
};

/**
 * Write the book: new debtors are created, debtors already on the platform
 * (matched by phone) are assigned to the campaign rather than duplicated.
 */
export async function commitBook(
  organizationId: string,
  userId: string,
  sheet: ParsedSheet,
  campaignId?: string,
): Promise<BookCommitResult> {
  if (campaignId) {
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign) throw new Error("Campaign not found.");
  }

  const mapped = mapBook(sheet);
  const existing = await db.debtor.findMany({
    where: { organizationId },
    select: { id: true, phone: true, accountNumber: true },
  });
  const byPhone = new Map(existing.map((d) => [phoneKey(d.phone), d]));
  const usedAccounts = new Set(existing.map((d) => d.accountNumber));

  const result: BookCommitResult = { created: 0, assignedExisting: 0, skipped: [] };
  const seenInFile = new Set<string>();

  for (const entry of mapped.rows) {
    if (entry.problem) {
      result.skipped.push({ row: entry.row, problem: entry.problem });
      continue;
    }
    const data = entry.data as BookRow;
    const key = phoneKey(data.phone);
    if (seenInFile.has(key)) {
      result.skipped.push({ row: entry.row, problem: "duplicate phone within the file" });
      continue;
    }
    seenInFile.add(key);

    const already = byPhone.get(key);
    if (already) {
      if (campaignId) {
        await db.debtor.update({ where: { id: already.id }, data: { campaignId } });
        result.assignedExisting += 1;
      } else {
        result.skipped.push({ row: entry.row, problem: "already on the platform (matched by phone)" });
      }
      continue;
    }

    // Account numbers are unique per organization; suffix a collision rather
    // than silently dropping the row.
    let accountNumber = data.accountNumber;
    while (usedAccounts.has(accountNumber)) accountNumber = `${data.accountNumber}-${result.created + 1}`;
    usedAccounts.add(accountNumber);

    const debtor = await db.debtor.create({
      data: {
        organizationId,
        campaignId: campaignId ?? null,
        firstName: data.firstName,
        lastName: data.lastName,
        accountNumber,
        phone: data.phone,
        email: data.email,
        city: data.city,
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId,
        debtorId: debtor.id,
        reference: data.unit ?? accountNumber,
        creditorName: data.creditorName,
        originalBalance: data.originalBalance,
        currentBalance: data.originalBalance,
        dueDate: new Date(),
      },
    });
    result.created += 1;
  }

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "debtors.book_imported",
    entityType: "campaign",
    entityId: campaignId ?? "none",
    detail: {
      format: mapped.format,
      created: result.created,
      assignedExisting: result.assignedExisting,
      skipped: result.skipped.length,
    },
  });

  return result;
}
