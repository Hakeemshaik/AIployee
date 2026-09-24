// Phone normalisation.
//
// Lives in lib/ rather than in the debtor service so it can be imported from
// client components and from the import mapper without dragging Prisma into
// the browser bundle.

/**
 * Normalize a South African phone number to E.164 where possible.
 *
 * Spreadsheet exports mangle numbers in predictable ways — Excel drops the
 * leading zero from `0821234567`, and "keep as text" markers leave a stray
 * apostrophe — so those shapes are accepted too.
 */
export function normalizePhone(raw: string): string | null {
  if (raw === null || raw === undefined) return null;
  const cleaned = String(raw).trim().replace(/^['`,]+/, "");
  const digits = cleaned.replace(/[^\d+]/g, "");

  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  // Excel turned the cell into a number and ate the leading zero.
  if (/^[678]\d{8}$/.test(digits)) return `+27${digits}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits; // other international
  return null;
}
