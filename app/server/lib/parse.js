/**
 * Turn an uploaded workbook into clean tenant records plus a quality report.
 */

import XLSX from 'xlsx';
import {
  FORMAT_MAP, FORMAT_LABELS, cleanName, cleanPhone, cleanBalance,
  detectFormatByShape, detectFormatByHeader, isSkipRow, deriveBatchName,
} from './formats.js';

const PLACEHOLDER = /\{\{.*?\}\}/;

/** Strip the template placeholders that leaked into 75 live records once. */
function cleanText(val) {
  if (val === null || val === undefined) return null;
  const s = String(val).trim();
  if (!s || s.toLowerCase() === 'nan' || PLACEHOLDER.test(s)) return null;
  return s;
}

function sheetToRows(ws) {
  return XLSX.utils.sheet_to_json(ws, { header: 1, raw: true, defval: null, blankrows: false });
}

/**
 * Read every sheet in the workbook and pick the one with the most usable rows.
 * Age-analysis workbooks routinely carry a cover sheet or a totals tab first.
 */
function pickSheet(wb) {
  let best = null;
  for (const name of wb.SheetNames) {
    const rows = sheetToRows(wb.Sheets[name]);
    const score = rows.filter((r) => r.filter((c) => c !== null && c !== '').length >= 3).length;
    if (!best || score > best.score) best = { name, rows, score };
  }
  return best || { name: null, rows: [], score: 0 };
}

export function parseWorkbook(buffer, filename) {
  const wb = XLSX.read(buffer, { type: 'buffer', cellDates: false });
  const { name: sheetName, rows } = pickSheet(wb);

  if (!rows.length) {
    return { error: 'The file has no readable rows.' };
  }

  // Prefer a real header row when one exists -- that is what lets an
  // unrecognised layout import instead of being force-fitted to a shape rule.
  const header = detectFormatByHeader(rows);
  let format, indices, startRow, headerLabels = null;

  if (header) {
    format = 'AUTO';
    indices = header.indices;
    startRow = header.headerRow + 1;
    headerLabels = header.labels;
  } else {
    format = detectFormatByShape(rows);
    const [name, balance, phone, unit, building, code] = FORMAT_MAP[format];
    indices = { name, balance, phone, unit, building, code };
    startRow = 0;
  }

  const records = [];
  const rejected = [];

  for (let r = startRow; r < rows.length; r++) {
    const row = rows[r] || [];
    const at = (i) => (i === null || i === undefined || i >= row.length ? null : row[i]);

    if (!header && isSkipRow(row[0])) continue;
    if (row.filter((c) => c !== null && c !== '').length === 0) continue;

    const rawName = at(indices.name);
    if (header && isSkipRow(rawName)) continue;

    const name = cleanName(rawName);
    const balance = cleanBalance(at(indices.balance));

    if (!name && balance === null) continue;             // spacer row

    if (!name) {
      rejected.push({ row: r + 1, reason: 'no usable name', raw: String(rawName ?? '').slice(0, 40) });
      continue;
    }
    if (balance === null) {
      rejected.push({ row: r + 1, reason: 'no positive balance', raw: name });
      continue;
    }

    const phoneResult = cleanPhone(at(indices.phone));
    const phone = phoneResult && typeof phoneResult === 'object' ? phoneResult.value : phoneResult;
    const phoneIssue = phoneResult && typeof phoneResult === 'object' ? phoneResult.reason : null;

    let code = cleanText(at(indices.code));
    if (format === 'E') code = cleanText(at(10)) ?? cleanText(at(0));
    if (format === 'F') code = cleanText(at(9)) ?? cleanText(at(0));

    records.push({
      name,
      phone,
      phoneIssue: phone ? null : (phoneIssue || 'missing or unparseable'),
      email: cleanText(at(indices.email)),
      unit_number: cleanText(at(indices.unit)),
      building_name: cleanText(at(indices.building)),
      total_due: balance,
      tenant_code: code,
      sourceRow: r + 1,
    });
  }

  return {
    sheetName,
    format,
    formatLabel: FORMAT_LABELS[format] || format,
    headerLabels,
    batchName: deriveBatchName(filename),
    totalRows: rows.length,
    records,
    rejected,
  };
}

/**
 * Dedupe and produce the quality report.
 *
 * Deduped on phone keeping the highest balance, so the agent opens on the
 * largest debt. The other units are kept on the record rather than discarded --
 * the office needs to see a tenant's full exposure.
 */
export function normalise(records) {
  const noPhone = [];
  const byPhone = new Map();

  for (const r of records) {
    if (!r.phone) { noPhone.push(r); continue; }
    const existing = byPhone.get(r.phone);
    if (!existing) {
      byPhone.set(r.phone, { ...r, alsoHolds: [] });
      continue;
    }
    const [keep, drop] = r.total_due > existing.total_due ? [r, existing] : [existing, r];
    const merged = {
      ...keep,
      alsoHolds: [
        ...(existing.alsoHolds || []),
        ...(drop.alsoHolds || []),
        { unit: drop.unit_number, building: drop.building_name, amount: drop.total_due },
      ],
    };
    byPhone.set(r.phone, merged);
  }

  const tenants = [...byPhone.values()].sort((a, b) => b.total_due - a.total_due);

  const multiUnit = tenants.filter((t) => t.alsoHolds.length > 0);
  const missingUnit = tenants.filter((t) => !t.unit_number).length;
  const missingBuilding = tenants.filter((t) => !t.building_name).length;

  return {
    tenants,
    quality: {
      parsed: records.length,
      callable: tenants.length,
      noPhone: noPhone.length,
      noPhoneList: noPhone.slice(0, 200).map((r) => ({
        name: r.name, unit: r.unit_number, building: r.building_name,
        amount: r.total_due, reason: r.phoneIssue, row: r.sourceRow,
      })),
      noPhoneValue: noPhone.reduce((s, r) => s + r.total_due, 0),
      duplicatesMerged: records.filter((r) => r.phone).length - tenants.length,
      multiUnit: multiUnit.length,
      multiUnitList: multiUnit.slice(0, 100).map((t) => ({
        name: t.name, phone: t.phone, primary: t.total_due, alsoHolds: t.alsoHolds,
        combined: t.total_due + t.alsoHolds.reduce((s, u) => s + (u.amount || 0), 0),
      })),
      missingUnit,
      missingBuilding,
      bookValue: tenants.reduce((s, t) => s + t.total_due, 0),
    },
  };
}
