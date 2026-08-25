import { db } from "@/lib/db";

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
  /** Only accounts at least this many days overdue. */
  minDaysOverdue?: number;
  /** Only accounts owing at least this much. */
  minBalance?: number;
};

export type JobixExport = {
  csv: string;
  rowCount: number;
  batch: string;
  excluded: { reason: string; count: number }[];
};

function csvCell(value: string | number | null | undefined): string {
  if (value === null || value === undefined) return "";
  const s = String(value);
  return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
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
    where: { organizationId, ...(campaign ? { campaignId: campaign.id } : {}) },
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
  const batch = `${(campaign?.name ?? "All accounts").replace(/[^A-Za-z0-9 -]/g, "").trim()} ${today.toISOString().slice(0, 10)}`;

  const rows: string[] = [];
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

    const name = `${debtor.firstName} ${debtor.lastName}`.trim();
    const amount = Math.round(balance);
    const values: Record<string, string | number> = {
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
    };
    rows.push(JOBIX_COLUMNS.map((c) => csvCell(values[c])).join(","));
  }

  const csv = [JOBIX_COLUMNS.join(","), ...rows].join("\n");
  return {
    csv,
    rowCount: rows.length,
    batch,
    excluded: Object.entries(excluded)
      .map(([reason, count]) => ({ reason, count }))
      .sort((a, b) => b.count - a.count),
  };
}
