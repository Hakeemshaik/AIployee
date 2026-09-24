import { normalizePhone } from "./phone";
import type { Grid } from "./spreadsheet";

// ---------------------------------------------------------------------------
// Import mapping.
//
// Works out what each column of an uploaded sheet means, so a file does not
// have to match a template. Two passes:
//
//   1. Header match — if a header row exists, map its labels to fields.
//   2. Content inference — profile each column (how many values are valid
//      phone numbers, how many parse as money, how repetitive the text is)
//      and assign the leftovers.
//
// Content inference is what makes headerless property exports work: an arrears
// sheet laid out as Property, Building, Unit, Tenant, Balance, Contact has no
// usable header, but the phone column is obvious from its contents and the
// building column is obvious from how often it repeats.
//
// Detection is a starting point, never the last word — the UI shows the
// mapping and lets the operator correct any column before importing.
// ---------------------------------------------------------------------------

export const IMPORT_FIELDS = [
  "fullName",
  "firstName",
  "lastName",
  "accountNumber",
  "phone",
  "altPhone",
  "email",
  "city",
  "province",
  "creditorName",
  "unit",
  "originalBalance",
  "currentBalance",
  "dueDate",
  "daysOverdue",
] as const;

export type ImportField = (typeof IMPORT_FIELDS)[number];

/** Column index → field. Columns absent from the map are ignored. */
export type ColumnMapping = Partial<Record<number, ImportField>>;

export const FIELD_LABELS: Record<ImportField, string> = {
  fullName: "Full name",
  firstName: "First name",
  lastName: "Surname",
  accountNumber: "Account / reference",
  phone: "Phone",
  altPhone: "Alternate phone",
  email: "Email",
  city: "City",
  province: "Province",
  creditorName: "Creditor / building",
  unit: "Unit / door",
  originalBalance: "Original balance",
  currentBalance: "Current balance",
  dueDate: "Due date",
  daysOverdue: "Days overdue",
};

// --- header matching --------------------------------------------------------

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

/**
 * Header synonyms, checked in order. Deliberately includes the property
 * vocabulary these arrears exports actually use ("tenant", "bal", "contact",
 * "door no") alongside generic collections terms.
 */
const HEADER_SYNONYMS: [ImportField, string[]][] = [
  ["firstName", ["firstname", "fname", "givenname", "name1"]],
  ["lastName", ["lastname", "surname", "lname", "familyname"]],
  ["fullName", ["fullname", "name", "customer", "customername", "tenant", "tenantname", "debtor", "debtorname", "client", "clientname", "accountholder", "nametenant", "contactname"]],
  ["accountNumber", ["accountnumber", "account", "accountno", "accno", "acc", "reference", "ref", "unitref", "accountref", "debtorcode", "code", "idnumber"]],
  ["phone", ["phone", "phonenumber", "contact", "contactnumber", "cell", "cellphone", "cellno", "mobile", "mobilenumber", "tel", "telephone", "msisdn", "number"]],
  ["altPhone", ["altphone", "alternatephone", "phone2", "cell2", "otherphone", "workphone", "homephone"]],
  ["email", ["email", "emailaddress", "mail", "epos"]],
  ["city", ["city", "town", "suburb"]],
  ["province", ["province", "state", "region"]],
  ["creditorName", ["creditorname", "creditor", "building", "buildingname", "property", "propertyname", "namebldg", "namebuilding", "complex", "scheme", "bodycorporate", "landlord", "prop"]],
  ["unit", ["unit", "unitnumber", "unitno", "doorno", "door", "flat", "flatno", "stand", "erf"]],
  ["currentBalance", ["currentbalance", "balance", "bal", "outstanding", "amountdue", "amountoutstanding", "arrears", "totaldue", "owing", "amount", "balancedue", "totalbalance"]],
  ["originalBalance", ["originalbalance", "originalamount", "opening", "openingbalance", "principal", "capital"]],
  ["dueDate", ["duedate", "due", "datedue", "invoicedate", "transactiondate"]],
  ["daysOverdue", ["daysoverdue", "days", "age", "aging", "ageing", "dayspastdue", "dpd", "overduedays"]],
];

function fieldForHeader(header: string): ImportField | null {
  const n = norm(header);
  if (!n) return null;
  for (const [field, names] of HEADER_SYNONYMS) {
    if (names.includes(n)) return field;
  }
  // Loosen to a contains match only for distinctive tokens, so "unit ref"
  // still lands but "name" does not swallow "building name".
  for (const [field, names] of HEADER_SYNONYMS) {
    for (const name of names) {
      if (name.length >= 5 && n.includes(name)) return field;
    }
  }
  return null;
}

/**
 * Find the header row: the row in the first few that maps the most labels.
 * Exports often carry a title and a blank line before the real header.
 */
export function detectHeaderRow(grid: Grid): number {
  let best = -1;
  let bestScore = 0;
  const limit = Math.min(grid.length, 10);
  for (let r = 0; r < limit; r++) {
    const row = grid[r];
    if (!row) continue;
    const filled = row.filter((c) => c !== "").length;
    if (filled < 2) continue;
    const matched = row.filter((c) => fieldForHeader(c) !== null).length;
    // A header row is mostly labels, not data.
    const score = matched >= 2 ? matched * 2 - r : 0;
    if (score > bestScore) {
      bestScore = score;
      best = r;
    }
  }
  return best;
}

// --- content profiling ------------------------------------------------------

const MONEY_CLEAN = /[\sR$€£,' ]/g;

/**
 * Parse a money-ish cell. Handles "R 1 234,56", "1,234.56", "(1 234)" for
 * negatives and bare integers. Returns null when the value is not a number.
 */
export function parseAmount(raw: string): number | null {
  if (!raw) return null;
  let s = raw.trim();
  if (!s) return null;

  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.startsWith("-")) {
    negative = true;
    s = s.slice(1);
  }

  const hasComma = s.includes(",");
  const hasDot = s.includes(".");
  s = s.replace(MONEY_CLEAN, (m) => (m === "," ? "," : ""));

  if (hasComma && hasDot) {
    // Whichever separator is last is the decimal one.
    s = s.lastIndexOf(",") > s.lastIndexOf(".") ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (hasComma) {
    // "1,50" is decimal; "1,500" is a thousands group.
    s = /,\d{1,2}$/.test(s) ? s.replace(",", ".") : s.replace(/,/g, "");
  }

  if (!/^\d*\.?\d+$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  return negative ? -n : n;
}

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const DATE_RE = /^(\d{4}-\d{2}-\d{2}|\d{1,2}[/-]\d{1,2}[/-]\d{2,4})$/;

type ColumnProfile = {
  index: number;
  filled: number;
  phoneRatio: number;
  emailRatio: number;
  numericRatio: number;
  dateRatio: number;
  alphaRatio: number;
  /** Values containing a space — person and building names usually do. */
  spaceRatio: number;
  /** Long unbroken digit runs — phone numbers, ID numbers, account codes. */
  idLikeRatio: number;
  distinctRatio: number;
  meanAbs: number;
  meanLength: number;
};

function profileColumn(rows: Grid, index: number): ColumnProfile {
  const values = rows.map((r) => r[index] ?? "").filter((v) => v !== "");
  const n = values.length || 1;

  let phone = 0;
  let email = 0;
  let numeric = 0;
  let date = 0;
  let alpha = 0;
  let space = 0;
  let idLike = 0;
  let absSum = 0;
  let lengthSum = 0;

  for (const v of values) {
    if (normalizePhone(v)) phone++;
    if (EMAIL_RE.test(v)) email++;
    const amount = parseAmount(v);
    if (amount !== null) {
      numeric++;
      absSum += Math.abs(amount);
    }
    if (DATE_RE.test(v)) date++;
    const letters = (v.match(/[a-z]/gi) ?? []).length;
    if (letters / v.length > 0.6) alpha++;
    if (/\s/.test(v.trim())) space++;
    // No separators and 9+ digits: an identifier, not an amount of money.
    if (/^\+?\d{9,15}$/.test(v.replace(/[\s-()]/g, ""))) idLike++;
    lengthSum += v.length;
  }

  return {
    index,
    filled: values.length,
    phoneRatio: phone / n,
    emailRatio: email / n,
    numericRatio: numeric / n,
    dateRatio: date / n,
    alphaRatio: alpha / n,
    spaceRatio: space / n,
    idLikeRatio: idLike / n,
    distinctRatio: new Set(values).size / n,
    meanAbs: numeric > 0 ? absSum / numeric : 0,
    meanLength: lengthSum / n,
  };
}

/**
 * Assign fields to columns from their contents alone.
 *
 * Only fills gaps — anything the header pass already claimed is left alone.
 */
export function inferByContent(rows: Grid, existing: ColumnMapping = {}): ColumnMapping {
  const width = rows.reduce((w, r) => Math.max(w, r.length), 0);
  const mapping: ColumnMapping = { ...existing };
  const taken = new Set(Object.values(mapping));
  const used = new Set(Object.keys(mapping).map(Number));

  const profiles: ColumnProfile[] = [];
  for (let i = 0; i < width; i++) {
    if (used.has(i)) continue;
    const p = profileColumn(rows, i);
    if (p.filled > 0) profiles.push(p);
  }

  const claim = (field: ImportField, p: ColumnProfile | undefined) => {
    if (!p || taken.has(field)) return;
    mapping[p.index] = field;
    taken.add(field);
    used.add(p.index);
  };
  const free = () => profiles.filter((p) => !used.has(p.index));

  // Phone and email are unambiguous from content, so they go first.
  claim("phone", free().filter((p) => p.phoneRatio > 0.5).sort((a, b) => b.phoneRatio - a.phoneRatio)[0]);
  claim("altPhone", free().filter((p) => p.phoneRatio > 0.5).sort((a, b) => b.phoneRatio - a.phoneRatio)[0]);
  claim("email", free().filter((p) => p.emailRatio > 0.5).sort((a, b) => b.emailRatio - a.emailRatio)[0]);

  // Money: the numeric column with the largest typical magnitude. Unit numbers,
  // floors and day counts are numeric too, but they are small.
  //
  // Identifier-shaped columns are excluded even though they are numeric and
  // huge: a phone or ID number that failed phone detection would otherwise win
  // on magnitude alone and be imported as everyone's balance.
  claim(
    "currentBalance",
    free()
      .filter((p) => p.numericRatio > 0.6 && p.meanAbs >= 50 && p.idLikeRatio < 0.5)
      .sort((a, b) => b.meanAbs - a.meanAbs)[0],
  );

  claim("dueDate", free().filter((p) => p.dateRatio > 0.6).sort((a, b) => b.dateRatio - a.dateRatio)[0]);

  // Text columns split by how repetitive they are. A person's name is nearly
  // unique per row; a building name repeats across every unit in it.
  const textCols = free().filter((p) => p.alphaRatio > 0.5 && p.numericRatio < 0.5);

  claim(
    "fullName",
    textCols
      .filter((p) => p.distinctRatio > 0.5)
      .sort((a, b) => b.spaceRatio - a.spaceRatio || b.distinctRatio - a.distinctRatio)[0],
  );

  // Sorted by length, not by repetition: a "Type" column (Flat, Duplex) repeats
  // even harder than the building name, so picking the most repetitive text
  // column would label every debtor's creditor as "Flat".
  claim(
    "creditorName",
    free()
      .filter((p) => p.alphaRatio > 0.5 && p.distinctRatio <= 0.6 && p.meanLength >= 5)
      .sort((a, b) => b.meanLength - a.meanLength)[0],
  );

  // Whatever short, highly-distinct column is left is the unit or reference.
  claim(
    "unit",
    free()
      .filter((p) => p.distinctRatio > 0.7 && p.meanLength <= 12)
      .sort((a, b) => b.distinctRatio - a.distinctRatio)[0],
  );

  return mapping;
}

export type DetectedMapping = {
  headerRow: number;
  /** First row of data (after the header, or 0 when headerless). */
  dataStart: number;
  mapping: ColumnMapping;
  headers: string[];
  /** Fields the importer needs that could not be found. */
  missingRequired: ImportField[];
  /** True when no usable header row was found and columns were inferred. */
  headerless: boolean;
};

/** Fields without which a row cannot become a debtor. */
const REQUIRED: ImportField[] = ["phone", "currentBalance"];

export function detectMapping(grid: Grid): DetectedMapping {
  const headerRow = detectHeaderRow(grid);
  const headerless = headerRow < 0;
  const dataStart = headerless ? 0 : headerRow + 1;
  const headers = headerless ? [] : grid[headerRow];

  let mapping: ColumnMapping = {};
  if (!headerless) {
    const claimed = new Set<ImportField>();
    headers.forEach((h, i) => {
      const field = fieldForHeader(h);
      // First column wins a field; a later duplicate is left for inference.
      if (field && !claimed.has(field)) {
        mapping[i] = field;
        claimed.add(field);
      }
    });
  }

  // Profile only the data rows, and only a sample — enough to be confident
  // without walking a 20,000-row book twice.
  const sample = grid.slice(dataStart, dataStart + 200);
  mapping = inferByContent(sample, mapping);

  const present = new Set(Object.values(mapping));
  const hasName = present.has("fullName") || (present.has("firstName") && present.has("lastName"));
  const missingRequired = REQUIRED.filter((f) => !present.has(f));
  if (!hasName) missingRequired.push("fullName");

  return { headerRow, dataStart, mapping, headers, missingRequired, headerless };
}

// --- value cleaning ---------------------------------------------------------

const TITLES = new Set([
  "mr", "mrs", "ms", "miss", "dr", "prof", "adv", "rev", "sir", "madam",
  "mnr", "mev", "mej", "me", "eng", "hon",
]);

/** Title Case a token, preserving internal capitals in names like McDonald. */
function titleToken(t: string): string {
  if (t.length === 0) return t;
  if (/[a-z]/.test(t) && /[A-Z]/.test(t)) return t; // already mixed — leave it
  // A one- or two-letter token written in capitals is an initial ("T", "TM"),
  // not a name to be title-cased into "Tm".
  if (t.length <= 2 && t === t.toUpperCase()) return t;
  return t[0].toUpperCase() + t.slice(1).toLowerCase();
}

export function cleanName(raw: string): string {
  return raw
    .replace(/[.]/g, " ")
    .split(/\s+/)
    .filter((t) => t !== "" && !TITLES.has(t.toLowerCase().replace(/[^a-z]/g, "")))
    .map(titleToken)
    .join(" ")
    .trim();
}

/**
 * Split a single name cell into first and last.
 *
 * Handles the three shapes these exports actually contain:
 *   "NKOSI, Thandi"  -> surname first, comma separated
 *   "NKOSI T"        -> surname then initials
 *   "Thandi Nkosi"   -> given name first
 */
export function splitName(raw: string): { firstName: string; lastName: string } {
  const cleaned = cleanName(raw.replace(/\s+/g, " ").trim());
  if (!cleaned) return { firstName: "", lastName: "" };

  if (raw.includes(",")) {
    const [last, first] = cleaned.split(/\s*,\s*/, 2);
    // A comma with nothing after it is just a stray separator.
    if (first?.trim()) return { firstName: first.trim(), lastName: last.trim() };
    return { firstName: last.trim(), lastName: "" };
  }

  const tokens = cleaned.split(" ");
  if (tokens.length === 1) return { firstName: tokens[0], lastName: "" };

  // Trailing initials mean surname-first, and the surname may be several
  // tokens: "Nkosi T", "Dlamini TM", "Van Wyk A".
  const last = tokens[tokens.length - 1];
  if (last.length <= 2) {
    return { firstName: last, lastName: tokens.slice(0, -1).join(" ") };
  }

  // Leading initials mean the surname follows: "TM Dlamini".
  if (tokens[0].length <= 2) {
    return { firstName: tokens[0], lastName: tokens.slice(1).join(" ") };
  }

  return { firstName: tokens[0], lastName: tokens.slice(1).join(" ") };
}

export type MappedRow = Record<string, string>;

export type BuildResult = {
  rows: MappedRow[];
  /** Rows dropped before validation, with the reason. */
  skipped: { row: number; reason: string }[];
};

/**
 * Turn a grid into the row objects importDebtors expects.
 *
 * Cleaning applied here rather than in the service so the preview shows the
 * operator exactly what will be stored.
 */
export function buildRows(
  grid: Grid,
  detected: DetectedMapping,
  options: { defaultCreditor?: string } = {},
): BuildResult {
  const { mapping, dataStart } = detected;
  const rows: MappedRow[] = [];
  const skipped: BuildResult["skipped"] = [];
  const seenAccounts = new Set<string>();

  for (let r = dataStart; r < grid.length; r++) {
    const cells = grid[r];
    if (!cells || cells.every((c) => c === "")) continue;
    const sheetRow = r + 1; // 1-based, as the operator sees it in Excel

    const get = (field: ImportField): string => {
      for (const [idx, f] of Object.entries(mapping)) {
        if (f === field) return cells[Number(idx)] ?? "";
      }
      return "";
    };

    // --- name ---
    let firstName = cleanName(get("firstName"));
    let lastName = cleanName(get("lastName"));
    if (!firstName && !lastName) {
      const split = splitName(get("fullName"));
      firstName = split.firstName;
      lastName = split.lastName;
    }
    if (!firstName && lastName) {
      firstName = lastName;
      lastName = "";
    }
    if (!firstName) {
      skipped.push({ row: sheetRow, reason: "no name in the row" });
      continue;
    }
    // importDebtors requires both parts; a single-token name repeats it rather
    // than losing the row.
    if (!lastName) lastName = firstName;

    // --- phone ---
    const rawPhone = get("phone") || get("altPhone");
    const phone = normalizePhone(rawPhone);
    if (!phone) {
      skipped.push({
        row: sheetRow,
        reason: rawPhone ? `phone "${rawPhone}" is not a valid number` : "no phone number",
      });
      continue;
    }

    // --- money ---
    const current = parseAmount(get("currentBalance"));
    const original = parseAmount(get("originalBalance")) ?? current;
    if (original === null || original <= 0) {
      skipped.push({ row: sheetRow, reason: "no outstanding balance" });
      continue;
    }

    // --- account reference ---
    // Prefer an explicit reference; otherwise build a stable one from the unit
    // and building so re-importing the same sheet updates rather than duplicates.
    const unit = get("unit").trim();
    const building = cleanName(get("creditorName")) || options.defaultCreditor || "";
    let accountNumber = get("accountNumber").trim();
    if (!accountNumber) {
      const base = [building.replace(/\s+/g, "-"), unit].filter(Boolean).join("-");
      accountNumber = base || phone.replace("+", "");
    }
    if (accountNumber.length < 2) accountNumber = `${accountNumber}-${phone.slice(-4)}`;
    // Two units can share a reference in a sloppy export; keep both rows.
    if (seenAccounts.has(accountNumber)) {
      accountNumber = `${accountNumber}-${phone.slice(-4)}`;
    }
    if (seenAccounts.has(accountNumber)) {
      skipped.push({ row: sheetRow, reason: `duplicate reference ${accountNumber}` });
      continue;
    }
    seenAccounts.add(accountNumber);

    const creditorName = building || "Unspecified creditor";

    const row: MappedRow = {
      firstName,
      lastName,
      accountNumber,
      phone,
      creditorName,
      // Whole rand — these books are managed in rands, and cents in a dialling
      // list only produce awkward agent script output.
      originalBalance: String(Math.round(original)),
    };
    if (current !== null) row.currentBalance = String(Math.round(current));

    const email = get("email").trim();
    if (EMAIL_RE.test(email)) row.email = email;
    const city = get("city").trim();
    if (city) row.city = cleanName(city);
    const province = get("province").trim();
    if (province) row.province = cleanName(province);
    const dueDate = get("dueDate").trim();
    if (dueDate) row.dueDate = dueDate;
    const days = parseAmount(get("daysOverdue"));
    if (days !== null && days >= 0) row.daysOverdue = String(Math.round(days));

    rows.push(row);
  }

  return { rows, skipped };
}
