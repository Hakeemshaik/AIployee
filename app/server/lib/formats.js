/**
 * Source-format detection and field cleaning.
 *
 * Ported from the mafadi-import-builder script so the console applies exactly
 * the same rules the manual pipeline did. Every cleaning rule here exists
 * because a real campaign was damaged without it -- see the notes on each.
 */

/* ------------------------------------------------------------------ *
 * Name cleaning
 * ------------------------------------------------------------------ */

// Anchored to the start of the string on purpose. The original script matched
// these anywhere, which meant the standalone M in a joint account like
// "Smith, J & M" was read as a title and stripped, silently truncating the name.
const LEADING_TITLE = /^(MR|MRS|MISS|MS|MNR|DR|PROF|MX)\b\.?\s*/i;

export function cleanName(val) {
  if (val === null || val === undefined) return null;
  let s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan') return null;

  // Junk after * or ( is a note to the property manager, not part of the name
  s = s.split(/[*(]/)[0].trim();
  s = s.replace(/\s+/g, ' ').trim();
  while (LEADING_TITLE.test(s)) s = s.replace(LEADING_TITLE, '').trim();
  if (!s) return null;

  // "Surname, Firstname" -> "Firstname Surname". Skipped when & is present,
  // because "Smith, J & M" is a joint account and flipping it reads wrong.
  if (s.includes(',') && !s.includes('&')) {
    const [a, b] = s.split(/,(.*)/s);
    s = `${(b || '').trim()} ${a.trim()}`.trim();
  }

  s = s.toLowerCase().replace(/(^|[\s'-])([a-z])/g, (_, p, c) => p + c.toUpperCase());
  return s || null;
}

/* ------------------------------------------------------------------ *
 * Phone cleaning
 * ------------------------------------------------------------------ */

/**
 * Normalise to E.164 (+27...).
 *
 * The float case matters most: Excel stores 0787766532 as 787766532.0, and
 * naive digit-stripping turns that into 7877665320 -- a different number that
 * still looks valid. Truncating the float first, then re-adding the dropped
 * leading zero, is what keeps it correct.
 */
export function cleanPhone(val) {
  if (val === null || val === undefined) return null;

  let s;
  if (typeof val === 'number') {
    if (!Number.isFinite(val)) return null;
    s = String(Math.trunc(val));
  } else {
    s = String(val).trim();
  }

  s = s.replace(/^["',\s]+/, '').replace(/["',\s]+$/, '');
  s = s.split(',')[0].trim();                 // "0821112222, 0833334444" -> first
  s = s.replace(/[\s\-()]/g, '');
  if (!s || s.toLowerCase() === 'nan') return null;

  // A trailing ".0" survives the number branch above only for string floats
  s = s.replace(/\.\d+$/, '');

  let digits = s.replace(/\D/g, '');
  if (!digits) return null;

  if (digits.startsWith('0027') && digits.length === 13) digits = '0' + digits.slice(4);
  else if (digits.startsWith('27') && digits.length === 11) digits = '0' + digits.slice(2);
  else if (digits.length === 9) digits = '0' + digits;   // leading 0 eaten by Excel

  if (digits.length !== 10 || !digits.startsWith('0')) return null;

  // SA mobile prefixes only -- 06/07/08. A landline cannot receive the campaign.
  if (!/^0[678]/.test(digits)) return { value: null, reason: 'not a mobile number' };

  return { value: '+27' + digits.slice(1), reason: null };
}

/* ------------------------------------------------------------------ *
 * Balance cleaning
 * ------------------------------------------------------------------ */

export function cleanBalance(val) {
  if (val === null || val === undefined) return null;
  if (typeof val === 'number') {
    if (!Number.isFinite(val) || val <= 0) return null;
    return Math.round(val);
  }
  let s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan') return null;

  // Accounting negatives: (1 234.56) means credit, not debt
  const bracketed = /^\((.*)\)$/.test(s);
  s = s.replace(/^\((.*)\)$/, '$1');
  s = s.replace(/[R\s_,]/gi, '');
  const n = Number.parseFloat(s);
  if (!Number.isFinite(n)) return null;
  const v = bracketed ? -n : n;
  if (v <= 0) return null;              // in credit or square -- not a debtor
  return Math.round(v);                 // whole rands, no cents
}

/* ------------------------------------------------------------------ *
 * Format detection
 * ------------------------------------------------------------------ */

/** column index map: [name, balance, phone, unit, building, code] */
export const FORMAT_MAP = {
  A: [6, 7, 8, 2, 1, 0],
  B: [4, 5, 6, 2, 1, 0],
  C: [5, 6, 7, 2, 1, 0],
  D: [5, 6, 7, 2, 1, 0],
  E: [7, 8, 9, 4, 3, 10],
  F: [6, 7, 8, 4, 3, 9],
  G: [2, 3, 4, 1, 0, null],
  H: [3, 4, 5, 1, 0, null],
};

export const FORMAT_LABELS = {
  A: '9-column age analysis',
  B: '7-column property listing',
  C: '8-column (no PFl)',
  D: '8-column (with PFl)',
  E: '11+ column with Unit Ref',
  F: '10-column with Unit Ref',
  G: '5-column short form',
  H: '6-column short form',
  AUTO: 'header-matched',
};

/**
 * Detect the layout of a headerless sheet by column count, exactly as the
 * original script did.
 */
export function detectFormatByShape(rows) {
  const ncols = Math.max(...rows.slice(0, 30).map((r) => r.length), 0);
  const row0 = (rows[0] || []).map((v) => (v === null || v === undefined ? '' : String(v).trim()));
  const has = (kw) => row0.some((v) => v.toLowerCase().includes(kw.toLowerCase()));

  if (ncols >= 11) return 'E';
  if (ncols === 10) return 'F';
  if (ncols === 9) return 'A';
  if (ncols === 8) return has('pfl') ? 'D' : 'C';
  if (ncols === 7) return 'B';
  if (ncols === 6) return 'H';
  if (ncols === 5) return 'G';
  if (has('prop')) return 'B';
  return 'G';
}

/* ------------------------------------------------------------------ *
 * Header matching -- handles formats the shape rules have never seen
 * ------------------------------------------------------------------ */

/**
 * Patterns are tried in order, most specific first, and the first pattern that
 * matches any column wins that column. Ordering matters: a sheet with both
 * "Prop" and "Building" columns must map building to "Building", which a single
 * combined regex gets wrong because it just takes the leftmost match.
 */
const HEADER_PATTERNS = {
  name: [
    /^(tenant|customer|client|debtor|owner|account)?\s*(name|full[\s_]*name)$/i,
    /^name$/i,
    /(tenant|customer|client|debtor|owner)[\s_]*name/i,
    /surname/i,
  ],
  phone: [
    /^(cell|cell[\s_]*(no|number)|mobile|mobile[\s_]*(no|number))$/i,
    /(cell|mobile|msisdn)/i,
    /(phone|contact[\s_]*(no|number)|tel)/i,
  ],
  balance: [
    /^(total[\s_]*due|amount[\s_]*due|arrears([\s_]*amount)?|balance|outstanding)$/i,
    /(total[\s_]*due|amount[\s_]*due|arrears)/i,
    /(balance|outstanding|o\/s|owing)/i,
    /due/i,
  ],
  email: [/e-?mail/i],
  unit: [
    /^(unit|unit[\s_]*(no|number)|door|stand)$/i,
    /^unit[\s_]*(ref|reference)$/i,
    /unit/i,
  ],
  building: [
    /^(building|complex|scheme|block)([\s_]*name)?$/i,
    /(building|complex|scheme|body[\s_]*corporate)/i,
    /(property|block|prop)/i,
  ],
  code: [
    /^(tenant[\s_]*code|account[\s_]*(no|code)|acc[\s_]*no)$/i,
    /(tenant[\s_]*code|account[\s_]*(no|code))/i,
    /(ref|code)/i,
  ],
};

/**
 * Look for a real header row in the first few rows. Returns a mapping when at
 * least a name column and a balance column can be identified, which is what
 * makes a genuinely unknown layout importable.
 */
export function detectFormatByHeader(rows) {
  for (let r = 0; r < Math.min(rows.length, 8); r++) {
    const cells = (rows[r] || []).map((v) => (v === null || v === undefined ? '' : String(v).trim()));
    if (cells.filter(Boolean).length < 3) continue;

    const found = {};
    const claimed = new Set();
    // Field order is the priority order for claiming a column, so "Unit Ref"
    // goes to unit rather than being taken by the looser code patterns.
    for (const [field, patterns] of Object.entries(HEADER_PATTERNS)) {
      for (const pattern of patterns) {
        let hit;
        for (let c = 0; c < cells.length; c++) {
          if (!cells[c] || claimed.has(c)) continue;
          if (pattern.test(cells[c])) { hit = c; break; }
        }
        if (hit !== undefined) { found[field] = hit; claimed.add(hit); break; }
      }
    }
    if (found.name !== undefined && found.balance !== undefined && found.phone !== undefined) {
      return { headerRow: r, indices: found, labels: cells };
    }
  }
  return null;
}

/* ------------------------------------------------------------------ *
 * Row filtering
 * ------------------------------------------------------------------ */

const SKIP_VALUES = new Set(['prop', 'name', 'unit', 'nan', '', 'total', 'totals', 'grand total']);

export function isSkipRow(val) {
  if (val === null || val === undefined) return true;
  const s = String(val).trim().toLowerCase();
  if (SKIP_VALUES.has(s)) return true;
  if (s.startsWith('unit o/s bals')) return true;
  if (s.startsWith('total')) return true;
  return false;
}

export function deriveBatchName(filename) {
  let name = String(filename).replace(/\.[^.]+$/, '').toUpperCase();
  name = name.replace(/^\d{2}_\d{2}_\d{4}_/, '').replace(/^\d{4}_\d{2}_\d{2}_/, '');
  name = name.replace(/_?A_?I_?CALLING$/, '').replace(/_?A_?I$/, '').replace(/_+$/, '');
  return name.replace(/^_+|_+$/g, '') || 'IMPORT';
}
