import { db } from "@/lib/db";
import { callColumnValue, loadFlowConfig } from "@/services/flow-config";

// ---------------------------------------------------------------------------
// Jobix import export.
//
// Produces the paste-ready import table for the Jobix dashboard
// (Database → paste box). The column set mirrors the structure the Jobix
// workspace already expects: contact/input fields are populated from the
// debtor book, and the agent's outcome fields are emitted empty so the
// layout matches on paste.
//
// The export is the dialling list, so it excludes anything that must not be
// called: opt-outs, do-not-contact flags, settled accounts, open disputes,
// live escalations and rows without a usable phone number.
// ---------------------------------------------------------------------------

/** Columns the Jobix import expects, in order. */
export const JOBIX_COLUMNS = [
  "SUID", "UUID", "Name", "Phone", "Email", "Timezone",
  "email", "phone", "full_name", "timezone", "main_unit_no",
  "unit_number", "total_due", "tenant_code", "batch",
  "Do not contact", "Do not message", "accounts_contact",
  "main_unit_no_", "suid", "uuid", "name", "do_not_contact",
  "do_not_message", "Call outcome", "month-of", "main_unit_no_suid",
  "debt_status", "audit_reasoning", "status_reason", "callback_time",
  "dnc_flag", "lead_status", "paymentcommit", "spoketo", "issues",
  "notpaying", "calloutcome_tag", "callbackdate", "tenantsentiment",
  "escalate", "language", "paidon", "location", "outcome_category",
  "call_summary", "ptp_payment_method", "ptp_note",
  "arrangement_proposed", "sentiment", "stated_reason_for_arrears",
  "dispute_raised", "callback_required", "human_review_required",
  "escalation_flag", "wrong_person", "maintenance_issue_flagged",
  "spoke_to_rep", "building_name", "arrears_amount",
  "proposed_arrangement_amount", "proposed_arrangement_day",
  "dispute_reason", "callback_date_time", "callback_assigned_to",
  "escalation_reason", "paid_already", "ptp_confirmed", "ptp_amount",
  "ptp_full_or_partial", "ptp_date", "call",
] as const;

/** Debtor states that must never enter a dialling list. */
const EXCLUDED_STATUSES = ["paid", "opted_out", "dispute", "escalated", "legal", "uncontactable"];

export type JobixExportOptions = {
  campaignId?: string;
  /**
   * This run's batch code. It goes in the `batch` column, which is the
   * attribution key: the flow never writes to it, so results can still be tied
   * back to this run long after dialling.
   *
   * The `call` column is separate, and is the flag the flow's entry filter
   * reads. By default it carries the batch code too, which means the filter has
   * to name that code — a flow edit before every run. Set JOBIX_CALL_FLAG to a
   * fixed word instead and the filter can be written once and left alone: the
   * platform decides who is dialled by which rows carry the flag, not by
   * editing the flow.
   */
  batchCode?: string;
  /**
   * Only these accounts. Used by redial, where the whole point is that the
   * batch contains the filtered contacts and nobody else.
   */
  debtorIds?: string[];
  /** Only accounts at least this many days overdue. */
  minDaysOverdue?: number;
  /** Only accounts owing at least this much. */
  minBalance?: number;
};

/**
 * One account's fields, before they become either a pasted row or an API
 * write.
 *
 * Both paths need exactly the same values, and the API path needs them keyed
 * rather than joined with commas — so the values are built once here and the
 * CSV is a rendering of them, not a separate construction.
 */
export type JobixRow = {
  debtorId: string;
  /** The caller's own stable id for this customer. The write API upserts on
   *  it, so it has to be the account number and nothing else. */
  suid: string;
  name: string;
  phone: string;
  values: Record<string, string | number>;
};

export type JobixExport = {
  csv: string;
  rowCount: number;
  rows: JobixRow[];
  batch: string;
  /** What went into the `call` column — what the flow's filter must look for. */
  callFlag: string | null;
  excluded: { reason: string; count: number }[];
};

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}

/**
 * The name as the platform should see it.
 *
 * A debtor with no surname on file carries an em-dash in ours, so lists stay
 * readable and rows stay tellable-apart. That is a display convention, not part
 * of anybody's name, and it has no business in a payload an agent reads out.
 * Real letters — accents and apostrophes included — are left exactly as they
 * are; only a standalone dash is dropped.
 */
export function plainWireName(name: string): string {
  const cleaned = name
    .split(/\s+/)
    .filter((part) => part !== "" && !/^[\u2014\u2013-]+$/.test(part))
    .join(" ")
    .trim();
  return cleaned || "Unknown";
}

export async function buildJobixExport(
  organizationId: string,
  options: JobixExportOptions = {},
): Promise<JobixExport> {
  const campaign = options.campaignId
    ? await db.campaign.findFirst({
        where: { id: options.campaignId, organizationId },
        select: { id: true, name: true },
      })
    : null;
  if (options.campaignId && !campaign) throw new Error("Campaign not found");

  const debtors = await db.debtor.findMany({
    where: {
      organizationId,
      ...(campaign ? { campaignId: campaign.id } : {}),
      ...(options.debtorIds ? { id: { in: options.debtorIds } } : {}),
    },
    include: {
      accounts: { orderBy: { createdAt: "asc" } },
      campaign: { select: { name: true } },
    },
    orderBy: [{ lastName: "asc" }, { firstName: "asc" }],
  });

  const excluded: Record<string, number> = {};
  const skip = (reason: string) => {
    excluded[reason] = (excluded[reason] ?? 0) + 1;
  };

  const today = new Date();
  // The batch column is machine-readable when a run code exists, because that
  // is what results are matched on later. Without one it is a readable label
  // for a plain export nobody is going to dial from.
  const batch =
    options.batchCode ??
    `${(campaign?.name ?? "All accounts").replace(/[^A-Za-z0-9 -]/g, "").trim()} ${today.toISOString().slice(0, 10)}`;

  // The flag the flow's entry filter looks for. A fixed word means the filter
  // never has to be edited again. Resolved through the shared config so the
  // file export and the in-app dialler always write the same thing.
  const callFlag = callColumnValue(await loadFlowConfig(organizationId), options.batchCode);

  const rows: JobixRow[] = [];
  for (const debtor of debtors) {
    if (debtor.doNotContact) {
      skip("do-not-contact flag");
      continue;
    }
    if (EXCLUDED_STATUSES.includes(debtor.status)) {
      skip(`status: ${debtor.status.replace(/_/g, " ")}`);
      continue;
    }
    if (!/^\+\d{8,15}$/.test(debtor.phone)) {
      skip("no usable phone number");
      continue;
    }
    const balance = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
    if (balance <= 0) {
      skip("nothing outstanding");
      continue;
    }
    const daysOverdue = Math.max(0, ...debtor.accounts.map((a) => a.daysOverdue));
    if (options.minDaysOverdue != null && daysOverdue < options.minDaysOverdue) {
      skip(`under ${options.minDaysOverdue} days overdue`);
      continue;
    }
    if (options.minBalance != null && balance < options.minBalance) {
      skip(`under R${options.minBalance} outstanding`);
      continue;
    }

    const name = plainWireName(`${debtor.firstName} ${debtor.lastName}`);
    const amount = Math.round(balance);
    const values: Record<string, string | number> = {
      SUID: debtor.accountNumber,
      suid: debtor.accountNumber,
      Name: name,
      name: name,
      full_name: name,
      Phone: debtor.phone,
      phone: debtor.phone,
      Email: debtor.email ?? "",
      email: debtor.email ?? "",
      Timezone: "Africa/Johannesburg",
      timezone: "Africa/Johannesburg",
      tenant_code: debtor.accountNumber,
      total_due: amount,
      arrears_amount: amount,
      building_name: debtor.accounts[0]?.creditorName ?? "",
      location: debtor.city ?? "",
      batch,
      language: "English",
      "month-of": today.toISOString().slice(0, 7),
      ...(callFlag ? { call: callFlag } : {}),
    };
    rows.push({
      debtorId: debtor.id,
      suid: debtor.accountNumber,
      name,
      phone: debtor.phone,
      values,
    });
  }

  const csv = [
    JOBIX_COLUMNS.join(","),
    ...rows.map((row) => JOBIX_COLUMNS.map((c) => csvCell(row.values[c])).join(",")),
  ].join("\n");
  return {
    csv,
    rowCount: rows.length,
    rows,
    batch,
    callFlag: callFlag ?? null,
    excluded: Object.entries(excluded)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
