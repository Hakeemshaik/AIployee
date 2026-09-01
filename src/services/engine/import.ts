import { createHash, randomUUID } from "node:crypto";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Paste → people.
//
// Client books arrive as one to four spreadsheets whose column layouts differ
// every time, with a title row or blank rows above the header. A human used to
// clean the names, fix the phone numbers, sum the balances and map it all into
// the fixed import format by hand. This is that human.
//
// The rules here are not invented — each one is a bug that has already
// happened on a real book: Excel eating leading zeros, floats growing ".0"
// tails, a tenant with three parking bays being dialled three times in one
// morning, an "Invest" column shoving the building name into the unit field.
// ---------------------------------------------------------------------------

export type ArrearsFormat = "A" | "B" | "C" | "D" | "E" | "F" | "G" | "H" | "I";

/** Column index map per format, 0-indexed. code=null means no tenant code. */
const FORMAT_MAP: Record<
  ArrearsFormat,
  { tenant: number; bal: number; phone: number; unit: number; building: number; code: number | null; codeFallback?: number }
> = {
  A: { tenant: 6, bal: 7, phone: 8, unit: 2, building: 1, code: 0 },
  B: { tenant: 4, bal: 5, phone: 6, unit: 2, building: 1, code: 0 },
  C: { tenant: 5, bal: 6, phone: 7, unit: 2, building: 1, code: 0 },
  D: { tenant: 5, bal: 6, phone: 7, unit: 2, building: 1, code: 0 },
  E: { tenant: 7, bal: 8, phone: 9, unit: 4, building: 3, code: 10, codeFallback: 0 },
  F: { tenant: 6, bal: 7, phone: 8, unit: 4, building: 3, code: 9, codeFallback: 0 },
  G: { tenant: 2, bal: 3, phone: 4, unit: 1, building: 0, code: null },
  H: { tenant: 3, bal: 4, phone: 5, unit: 1, building: 0, code: null },
  I: { tenant: 3, bal: 4, phone: 5, unit: 2, building: 1, code: 0 },
};

export type FieldMapping = {
  tenant: number;
  bal: number;
  phone: number;
  unit: number;
  building: number;
  code: number | null;
};

const HEADER_WORDS = /tenant|balance|contact|building|unit|prop\b/i;

function cell(row: unknown[], index: number | null | undefined): string {
  if (index === null || index === undefined) return "";
  const value = row[index];
  if (value === null || value === undefined) return "";
  return String(value).trim();
}

/**
 * Find the header row — it is NOT row 0. Real files open with a title line
 * ("ARREARS AS AT 31 AUG") and blank rows; the header is wherever the known
 * words are. Only the first four rows are scanned: a header deeper than that
 * is a file strange enough to deserve the manual mapper.
 */
export function findHeaderRow(rows: unknown[][]): number | null {
  for (let i = 0; i < Math.min(4, rows.length); i += 1) {
    const joined = rows[i].map((value) => String(value ?? "")).join(" ");
    if (HEADER_WORDS.test(joined) && rows[i].filter((v) => String(v ?? "").trim() !== "").length >= 4) {
      return i;
    }
  }
  return null;
}

/**
 * Which layout this is, from the column count first and the header words where
 * counts collide. Returns null rather than guessing — a wrong mapping puts the
 * building name in the unit field and nobody notices until the agent reads it
 * out. The caller then shows the manual mapper.
 */
export function detectFormat(headerRow: unknown[]): ArrearsFormat | null {
  const cells = headerRow.map((value) => String(value ?? "").trim());
  // Trailing empty header cells are padding, not columns.
  while (cells.length > 0 && cells[cells.length - 1] === "") cells.pop();
  const count = cells.length;
  const has = (word: string) => cells.some((c) => c.toLowerCase() === word.toLowerCase());

  if (count === 5) return "G";
  if (count === 6) return has("Prop") ? "I" : "H";
  if (count === 7) return "B";
  if (count === 8) return has("PFl") ? "D" : "C";
  if (count === 9) return "A";
  if (count === 10) {
    // The trap that already shipped a bug: a 10-column file with an extra
    // "Invest" column is Format A plus padding, and reading it as F puts the
    // building in the unit field. Only Cc/Let headers make it F.
    return has("Cc") || has("Let") ? "F" : "A";
  }
  if (count >= 11) return has("Cc") || has("Let") ? "E" : null;
  return null;
}

/** A stable fingerprint of a header row, for remembering manual mappings. */
export function headerFingerprint(headerRow: unknown[]): string {
  const joined = headerRow.map((value) => String(value ?? "").trim().toLowerCase()).join("|");
  return createHash("sha256").update(joined).digest("hex").slice(0, 24);
}

// ---------------------------------------------------------------------------
// Names
// ---------------------------------------------------------------------------

const TITLES = new Set(["MR", "MRS", "MISS", "MS", "MNR", "DR", "PROF", "MX", "MI", "M"]);

function titleCase(word: string): string {
  if (word.length === 0) return word;
  // Keep particles and hyphenated parts readable: VAN DER MERWE → Van Der Merwe.
  return word
    .split("-")
    .map((part) => (part ? part[0].toUpperCase() + part.slice(1).toLowerCase() : part))
    .join("-");
}

export function cleanName(raw: string): { fullName: string; greetingName: string } | null {
  let name = String(raw ?? "").trim();
  if (!name) return null;

  // Everything from the first * or ( is bookkeeping, not name.
  name = name.replace(/[*(][\s\S]*$/, "").trim();

  // Surname-first with a comma — but never flip a joint account ("A & B").
  if (name.includes(",") && !name.includes("&")) {
    const [surname, rest] = name.split(",", 2);
    name = `${(rest ?? "").trim()} ${surname.trim()}`.trim();
  }

  // Titles as whole words, any case, anywhere at the front.
  const words = name.split(/\s+/).filter((word) => {
    const bare = word.replace(/[.]/g, "").toUpperCase();
    return !TITLES.has(bare);
  });
  name = words.join(" ").trim();
  if (!name) return null;

  // ALL CAPS reads as shouting and sorts wrong; sentence-case it. A name that
  // already has case is left exactly as its owner writes it.
  if (name === name.toUpperCase()) {
    name = name.split(/\s+/).map(titleCase).join(" ");
  }
  name = name.replace(/\s+/g, " ").trim();
  if (!name) return null;

  // greeting_name: the version safe to open a written message with.
  let greeting = name;
  greeting = greeting.split(/[/&]/)[0].trim(); // joint accounts: greet the first person
  greeting = greeting.replace(/\[[^\]]*\]|\{[^}]*\}/g, "").trim(); // bracketed codes
  greeting = greeting.replace(/\b\d+\w*\b/g, "").trim(); // unit numbers that leaked in
  // Trailing single-letter initials: "Khumalo B T" → "Khumalo".
  const parts = greeting.split(/\s+/);
  while (parts.length > 1 && /^[A-Za-z]\.?$/.test(parts[parts.length - 1])) parts.pop();
  greeting = parts.join(" ").replace(/\s+/g, " ").trim();
  // A lone initial is not a greeting. "Dear B" is worse than the full name.
  if (greeting.replace(/[.]/g, "").length <= 2) greeting = "";

  return { fullName: name, greetingName: greeting || name };
}

// ---------------------------------------------------------------------------
// Phones
// ---------------------------------------------------------------------------

/**
 * To E.164 (+27XXXXXXXXX, 12 characters) or null for "no usable number".
 * Null keeps the account — as undialable — it never silently drops it.
 */
export function cleanPhone(raw: string): string | null {
  let value = String(raw ?? "").trim();
  if (!value) return null;
  // Several numbers in one cell: the first one is the one on record.
  value = value.split(",")[0];
  // Excel float corruption: 27787858045.0
  value = value.replace(/\.0+$/, "");
  const digits = value.replace(/[^\d]/g, "");

  if (digits.length === 11 && digits.startsWith("27")) return `+${digits}`;
  if (digits.length === 10 && digits.startsWith("0")) return `+27${digits.slice(1)}`;
  // Excel ate the leading zero.
  if (digits.length === 9 && !digits.startsWith("0")) return `+27${digits}`;
  return null;
}

/** Whole rand, or null when the row should be skipped. */
export function cleanAmount(raw: string): number | null {
  const value = String(raw ?? "").replace(/[R\s,]/gi, "").trim();
  if (!value) return null;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return null;
  const rounded = Math.round(parsed);
  return rounded > 0 ? rounded : null;
}

// ---------------------------------------------------------------------------
// Rows → people
// ---------------------------------------------------------------------------

export type ParsedRow = {
  fullName: string;
  greetingName: string;
  phone: string | null;
  balance: number;
  unitNumber: string | null;
  buildingName: string | null;
  tenantCode: string | null;
  sourceFile: string;
  sourceRow: number;
};

export type ParseResult = {
  rows: ParsedRow[];
  skipped: { row: number; reason: string }[];
  format: ArrearsFormat | "manual";
};

export function parseSheet(
  rows: unknown[][],
  mapping: FieldMapping,
  sourceFile: string,
  headerRow: number,
  format: ArrearsFormat | "manual",
): ParseResult {
  const out: ParsedRow[] = [];
  const skipped: { row: number; reason: string }[] = [];

  for (let i = headerRow + 1; i < rows.length; i += 1) {
    const row = rows[i];
    if (!row || row.every((value) => String(value ?? "").trim() === "")) continue;

    const name = cleanName(cell(row, mapping.tenant));
    if (!name) {
      skipped.push({ row: i + 1, reason: "no name after cleaning" });
      continue;
    }
    const balance = cleanAmount(cell(row, mapping.bal));
    if (balance === null) {
      skipped.push({ row: i + 1, reason: "zero, negative or unreadable balance" });
      continue;
    }
    const phone = cleanPhone(cell(row, mapping.phone));

    let tenantCode: string | null = null;
    if (mapping.code !== null) {
      tenantCode = cell(row, mapping.code) || null;
    }

    out.push({
      fullName: name.fullName,
      greetingName: name.greetingName,
      phone,
      balance,
      unitNumber: cell(row, mapping.unit) || null,
      buildingName: cell(row, mapping.building) || null,
      tenantCode,
      sourceFile,
      sourceRow: i + 1,
    });
  }

  return { rows: out, skipped, format };
}

// ---------------------------------------------------------------------------
// Dedupe — the step that decides the call count
// ---------------------------------------------------------------------------

export type DedupedAccount = {
  fullName: string;
  greetingName: string;
  phone: string | null;
  email: string | null;
  totalDue: number;
  /** The largest single unit's own balance — what a per-unit quote would say. */
  quotedUnitDue: number;
  unitsHeld: number;
  multiUnit: boolean;
  unitNumber: string | null;
  buildingName: string | null;
  tenantCode: string | null;
  sourceFile: string;
  sourceRow: number;
};

/**
 * One account per phone. A tenant with three units appears on three rows and
 * would be dialled three times in one round; here they become one person who
 * owes the sum, described by their largest-balance unit. Rows with no phone
 * stay individual — there is nothing to collapse them on, and each one still
 * belongs on the no-contact-number list.
 */
export function dedupeByPhone(rows: ParsedRow[]): DedupedAccount[] {
  const byPhone = new Map<string, ParsedRow[]>();
  const noPhone: ParsedRow[] = [];
  for (const row of rows) {
    if (!row.phone) {
      noPhone.push(row);
      continue;
    }
    const list = byPhone.get(row.phone) ?? [];
    list.push(row);
    byPhone.set(row.phone, list);
  }

  const toAccount = (group: ParsedRow[]): DedupedAccount => {
    const largest = group.reduce((a, b) => (b.balance > a.balance ? b : a));
    return {
      fullName: largest.fullName,
      greetingName: largest.greetingName,
      phone: largest.phone,
      email: null,
      totalDue: group.reduce((sum, row) => sum + row.balance, 0),
      quotedUnitDue: largest.balance,
      unitsHeld: group.length,
      multiUnit: group.length > 1,
      // The agent quotes one unit; it should be the one with the money on it.
      unitNumber: largest.unitNumber,
      buildingName: largest.buildingName,
      tenantCode: largest.tenantCode,
      sourceFile: largest.sourceFile,
      sourceRow: largest.sourceRow,
    };
  };

  return [
    ...[...byPhone.values()].map(toAccount),
    ...noPhone.map((row) => toAccount([row])),
  ];
}

// ---------------------------------------------------------------------------
// Persisting the book into a campaign
// ---------------------------------------------------------------------------

export type ImportSummary = {
  accounts: number;
  arrears: number;
  undialable: number;
  /** Multi-unit tenants: what they owe in total vs their largest unit alone.
   *  The difference is the arrears a per-unit quote would never mention —
   *  under this import the agent quotes the TOTAL, so the panel is the
   *  receipt that nothing is hidden, not a warning that something is. */
  multiUnit: { count: number; total: number; largestUnitOnly: number; difference: number };
  skipped: { row: number; reason: string }[];
  rowsCollapsed: number;
};

export async function importIntoEngine(
  organizationId: string,
  campaignId: string,
  userId: string,
  parsed: ParseResult[],
): Promise<ImportSummary> {
  const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!campaign) throw new Error("Campaign not found");
  if (!["none", "draft"].includes(campaign.engineStatus)) {
    throw new Error("This campaign's book is already loaded — the engine has started.");
  }

  const allRows = parsed.flatMap((p) => p.rows);
  const accounts = dedupeByPhone(allRows);
  if (accounts.length === 0) throw new Error("Nothing importable — every row was skipped.");

  // One account per phone per campaign is also a DB constraint; this check
  // exists to say WHICH phone rather than surface a constraint error.
  const phones = accounts.map((a) => a.phone).filter((p): p is string => p !== null);
  if (new Set(phones).size !== phones.length) {
    throw new Error("Duplicate phone after dedupe — this is a bug, refusing to import.");
  }

  await db.$transaction(async (tx) => {
    // Re-importing a draft replaces the draft book rather than stacking on it.
    await tx.engineAccount.deleteMany({ where: { campaignId } });
    for (const account of accounts) {
      const debtor = account.phone
        ? await tx.debtor.findFirst({
            where: { organizationId, phone: account.phone },
            select: { id: true },
          })
        : null;
      await tx.engineAccount.create({
        data: {
          organizationId,
          campaignId,
          debtorId: debtor?.id ?? null,
          suid: randomUUID(),
          fullName: account.fullName,
          greetingName: account.greetingName,
          phone: account.phone,
          email: account.email,
          unitNumber: account.unitNumber,
          buildingName: account.buildingName,
          tenantCode: account.tenantCode,
          totalDue: account.totalDue,
          unitsHeld: account.unitsHeld,
          multiUnit: account.multiUnit,
          sourceFile: account.sourceFile,
          sourceRow: account.sourceRow,
          state: account.phone ? "pending" : "undialable",
        },
      });
    }
    await tx.campaign.update({
      where: { id: campaignId },
      data: { engineStatus: "ready", currentRound: 0 },
    });
  });

  const multiUnit = accounts.filter((a) => a.multiUnit);
  const summary: ImportSummary = {
    accounts: accounts.length,
    arrears: accounts.reduce((sum, a) => sum + a.totalDue, 0),
    undialable: accounts.filter((a) => a.phone === null).length,
    multiUnit: {
      count: multiUnit.length,
      total: multiUnit.reduce((sum, a) => sum + a.totalDue, 0),
      largestUnitOnly: multiUnit.reduce((sum, a) => sum + a.quotedUnitDue, 0),
      difference: multiUnit.reduce((sum, a) => sum + (a.totalDue - a.quotedUnitDue), 0),
    },
    skipped: parsed.flatMap((p) => p.skipped),
    rowsCollapsed: allRows.length - accounts.length,
  };

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "engine.book_imported",
    entityType: "campaign",
    entityId: campaignId,
    detail: {
      accounts: summary.accounts,
      arrears: summary.arrears,
      undialable: summary.undialable,
      rowsCollapsed: summary.rowsCollapsed,
    },
  });

  return summary;
}

export { FORMAT_MAP };
