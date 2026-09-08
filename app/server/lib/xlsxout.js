/**
 * 72-column import workbook, for the manual-upload path and for handing a
 * redial round to anyone who wants the file rather than the dispatcher.
 */

import XLSX from 'xlsx';

export const ALL_COLUMNS = [
  'SUID', 'UUID', 'Name', 'Phone', 'Email', 'Timezone',
  'email', 'phone', 'full_name', 'timezone', 'main_unit_no',
  'unit_number', 'total_due', 'tenant_code', 'batch',
  'Do not contact', 'Do not message', 'accounts_contact',
  'main_unit_no_', 'suid', 'uuid', 'name', 'do_not_contact',
  'do_not_message', 'Call outcome', 'month-of', 'main_unit_no_suid',
  'debt_status', 'audit_reasoning', 'status_reason', 'callback_time',
  'dnc_flag', 'lead_status', 'paymentcommit', 'spoketo', 'issues',
  'notpaying', 'calloutcome_tag', 'callbackdate', 'tenantsentiment',
  'escalate', 'language', 'paidon', 'location', 'outcome_category',
  'call_summary', 'ptp_payment_method', 'ptp_note',
  'arrangement_proposed', 'sentiment', 'stated_reason_for_arrears',
  'dispute_raised', 'callback_required', 'human_review_required',
  'escalation_flag', 'wrong_person', 'maintenance_issue_flagged',
  'spoke_to_rep', 'building_name', 'arrears_amount',
  'proposed_arrangement_amount', 'proposed_arrangement_day',
  'dispute_reason', 'callback_date_time', 'callback_assigned_to',
  'escalation_reason', 'paid_already', 'ptp_confirmed', 'ptp_amount',
  'ptp_full_or_partial', 'ptp_date', 'call',
];

export function buildImportWorkbook(tenants, { batch, callCode }) {
  const rows = tenants.map((t) => {
    const row = Object.fromEntries(ALL_COLUMNS.map((c) => [c, null]));
    row.Name = row.name = row.full_name = t.name;
    row.Phone = row.phone = t.phone;
    row.Email = row.email = t.email || null;
    row.Timezone = row.timezone = 'Africa/Johannesburg';
    row.unit_number = row.main_unit_no = row.main_unit_no_ = t.unit_number || null;
    row.total_due = row.arrears_amount = t.total_due;
    row.tenant_code = t.tenant_code || null;
    row.batch = batch || null;
    row.building_name = t.building_name || null;
    row.call = callCode || null;
    return row;
  });

  const ws = XLSX.utils.json_to_sheet(rows, { header: ALL_COLUMNS });
  ws['!cols'] = ALL_COLUMNS.map((c) => ({ wch: Math.max(10, Math.min(24, c.length + 4)) }));
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, 'Import');
  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}

/** Plain review sheet -- what a person reads before approving a round. */
export function buildReviewWorkbook(tenants, quality) {
  const wb = XLSX.utils.book_new();

  const list = tenants.map((t) => ({
    Name: t.name, Phone: t.phone, Unit: t.unit_number, Building: t.building_name,
    'Total due': t.total_due, 'Tenant code': t.tenant_code, Batch: t.batchNo ?? '',
    Dispatched: t.dispatch?.status || '', Calls: t.call?.calls ?? '',
    Reached: t.call?.reached === undefined ? '' : (t.call.reached ? 'Yes' : 'No'),
    'Dead number': t.call?.dead ? 'Yes' : '', Outcome: t.call?.outcome || '',
  }));
  XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(list), 'Tenants');

  if (quality?.noPhoneList?.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quality.noPhoneList.map((r) => ({
      Name: r.name, Unit: r.unit, Building: r.building, 'Total due': r.amount,
      Problem: r.reason, 'Source row': r.row,
    }))), 'No usable number');
  }

  if (quality?.multiUnitList?.length) {
    XLSX.utils.book_append_sheet(wb, XLSX.utils.json_to_sheet(quality.multiUnitList.map((r) => ({
      Name: r.name, Phone: r.phone, 'Called on': r.primary,
      'Other units': r.alsoHolds.map((u) => `${u.unit || '?'} (R${u.amount || 0})`).join(', '),
      'Combined exposure': r.combined,
    }))), 'Multi-unit tenants');
  }

  return XLSX.write(wb, { type: 'buffer', bookType: 'xlsx' });
}
