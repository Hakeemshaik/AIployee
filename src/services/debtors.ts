import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { riskBand } from "@/lib/domain";
import { daysBetween, startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// Debtor service. All queries are organization-scoped. List filtering that
// depends on aggregated account values (amount, days overdue) is applied in
// memory after the scoped fetch — acceptable at MVP book sizes and swapped
// for SQL aggregation when the book grows.
// ---------------------------------------------------------------------------

export type DebtorFilters = {
  search?: string;
  status?: string;
  campaignId?: string;
  risk?: "low" | "medium" | "high";
  minAmount?: number;
  maxAmount?: number;
  minDaysOverdue?: number;
  maxDaysOverdue?: number;
  lastContactDays?: number; // contacted within N days
  promiseStatus?: "has_open" | "overdue" | "none";
};

export type DebtorRow = {
  id: string;
  name: string;
  accountNumber: string;
  phone: string;
  outstanding: number;
  daysOverdue: number;
  lastContactAt: Date | null;
  lastOutcome: string | null;
  promiseAmount: number | null;
  promiseDate: Date | null;
  status: string;
  riskScore: number;
  riskBand: "low" | "medium" | "high";
  campaignName: string | null;
};

export async function listDebtors(
  organizationId: string,
  filters: DebtorFilters = {},
): Promise<DebtorRow[]> {
  const debtors = await db.debtor.findMany({
    where: {
      organizationId,
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.search
        ? {
            OR: [
              { firstName: { contains: filters.search } },
              { lastName: { contains: filters.search } },
              { accountNumber: { contains: filters.search } },
              { phone: { contains: filters.search.replace(/[\s()-]/g, "") } },
            ],
          }
        : {}),
    },
    include: {
      accounts: { select: { currentBalance: true, daysOverdue: true } },
      campaign: { select: { name: true } },
      promises: {
        where: { status: "pending" },
        orderBy: { promisedDate: "asc" },
        take: 1,
        select: { amount: true, promisedDate: true },
      },
    },
    orderBy: { updatedAt: "desc" },
  });

  const today = startOfDay(new Date());
  let rows: DebtorRow[] = debtors.map((d) => {
    const outstanding = d.accounts.reduce((s, a) => s + a.currentBalance, 0);
    const daysOverdue = Math.max(0, ...d.accounts.map((a) => a.daysOverdue));
    const openPromise = d.promises[0] ?? null;
    return {
      id: d.id,
      name: `${d.firstName} ${d.lastName}`,
      accountNumber: d.accountNumber,
      phone: d.phone,
      outstanding,
      daysOverdue,
      lastContactAt: d.lastContactAt,
      lastOutcome: d.lastOutcome,
      promiseAmount: openPromise?.amount ?? null,
      promiseDate: openPromise?.promisedDate ?? null,
      status: d.status,
      riskScore: d.riskScore,
      riskBand: riskBand(d.riskScore),
      campaignName: d.campaign?.name ?? null,
    };
  });

  if (filters.risk) rows = rows.filter((r) => r.riskBand === filters.risk);
  if (filters.minAmount != null) rows = rows.filter((r) => r.outstanding >= filters.minAmount!);
  if (filters.maxAmount != null) rows = rows.filter((r) => r.outstanding <= filters.maxAmount!);
  if (filters.minDaysOverdue != null) rows = rows.filter((r) => r.daysOverdue >= filters.minDaysOverdue!);
  if (filters.maxDaysOverdue != null) rows = rows.filter((r) => r.daysOverdue <= filters.maxDaysOverdue!);
  if (filters.lastContactDays != null) {
    const cutoff = new Date(Date.now() - filters.lastContactDays * 86_400_000);
    rows = rows.filter((r) => r.lastContactAt && r.lastContactAt >= cutoff);
  }
  if (filters.promiseStatus === "has_open") rows = rows.filter((r) => r.promiseAmount != null);
  if (filters.promiseStatus === "overdue") {
    rows = rows.filter((r) => r.promiseDate && startOfDay(r.promiseDate) < today);
  }
  if (filters.promiseStatus === "none") rows = rows.filter((r) => r.promiseAmount == null);

  return rows;
}

export type TimelineEntry = {
  id: string;
  at: Date;
  kind: "call" | "sms" | "promise" | "payment" | "escalation";
  title: string;
  detail: string | null;
  outcome?: string | null;
  callStatus?: string | null;
  amount?: number | null;
  date?: Date | null;
  href?: string;
};

export async function getDebtorProfile(organizationId: string, debtorId: string) {
  const debtor = await db.debtor.findFirst({
    where: { id: debtorId, organizationId },
    include: {
      accounts: true,
      campaign: { select: { id: true, name: true } },
      calls: {
        orderBy: { startedAt: "desc" },
        include: { analysis: true, agent: { select: { name: true } } },
      },
      promises: { orderBy: { createdAt: "desc" } },
      payments: { orderBy: { paidAt: "desc" } },
      escalations: { orderBy: { createdAt: "desc" } },
    },
  });
  if (!debtor) return null;

  const smsEvents = await db.platformEvent.findMany({
    where: { organizationId, type: "sms.sent", entityId: debtorId },
    orderBy: { createdAt: "desc" },
  });

  const timeline: TimelineEntry[] = [
    ...debtor.calls.map((c) => ({
      id: `call-${c.id}`,
      at: c.startedAt,
      kind: "call" as const,
      title: "AI call",
      callStatus: c.status,
      outcome: c.analysis?.outcome ?? c.outcome,
      detail: c.analysis?.summary ?? null,
      amount: c.analysis?.promisedAmount ?? null,
      date: c.analysis?.promisedDate ?? null,
      href: `/calls/${c.id}`,
    })),
    ...smsEvents.map((e) => ({
      id: `sms-${e.id}`,
      at: e.createdAt,
      kind: "sms" as const,
      title: "SMS sent",
      detail: e.payload ? (JSON.parse(e.payload).template ?? null) : null,
    })),
    ...debtor.promises.map((p) => ({
      id: `promise-${p.id}`,
      at: p.createdAt,
      kind: "promise" as const,
      title: "Promise to pay recorded",
      detail: null,
      outcome: p.status,
      amount: p.amount,
      date: p.promisedDate,
    })),
    ...debtor.payments.map((p) => ({
      id: `payment-${p.id}`,
      at: p.paidAt,
      kind: "payment" as const,
      title: "Payment received",
      detail: p.reference,
      outcome: p.status,
      amount: p.amount,
    })),
    ...debtor.escalations.map((e) => ({
      id: `escalation-${e.id}`,
      at: e.createdAt,
      kind: "escalation" as const,
      title: "Escalated to human collector",
      detail: e.notes,
      outcome: e.reason,
    })),
  ].sort((a, b) => b.at.getTime() - a.at.getTime());

  const outstanding = debtor.accounts.reduce((s, a) => s + a.currentBalance, 0);
  const originalBalance = debtor.accounts.reduce((s, a) => s + a.originalBalance, 0);
  const amountPaid = debtor.accounts.reduce((s, a) => s + a.amountPaid, 0);
  const connectedCalls = debtor.calls.filter((c) => c.status === "completed");

  return {
    debtor,
    timeline,
    stats: {
      outstanding,
      originalBalance,
      amountPaid,
      daysOverdue: Math.max(0, ...debtor.accounts.map((a) => a.daysOverdue)),
      dueDate: debtor.accounts[0]?.dueDate ?? null,
      contactAttempts: debtor.calls.length,
      successfulContacts: connectedCalls.length,
      riskBand: riskBand(debtor.riskScore),
      openPromise: debtor.promises.find((p) => p.status === "pending") ?? null,
    },
  };
}

// ---------------------------------------------------------------------------
// Import & campaign assignment
// ---------------------------------------------------------------------------

/** Normalize a South African phone number to E.164 where possible. */
export function normalizePhone(raw: string): string | null {
  const digits = raw.replace(/[^\d+]/g, "");
  if (/^\+27\d{9}$/.test(digits)) return digits;
  if (/^27\d{9}$/.test(digits)) return `+${digits}`;
  if (/^0\d{9}$/.test(digits)) return `+27${digits.slice(1)}`;
  if (/^\+\d{8,15}$/.test(digits)) return digits; // other international
  return null;
}

export const importRowSchema = z.object({
  firstName: z.string().min(1).max(80),
  lastName: z.string().min(1).max(80),
  accountNumber: z.string().min(2).max(60),
  phone: z.string().min(6).max(30),
  email: z.string().email().optional().or(z.literal("")),
  city: z.string().max(80).optional(),
  province: z.string().max(80).optional(),
  creditorName: z.string().min(1).max(120),
  originalBalance: z.coerce.number().positive().max(100_000_000),
  currentBalance: z.coerce.number().min(0).max(100_000_000).optional(),
  dueDate: z.coerce.date().optional(),
  daysOverdue: z.coerce.number().int().min(0).max(3650).optional(),
});
export type ImportRow = z.infer<typeof importRowSchema>;

export type ImportResult = {
  created: number;
  skipped: { row: number; reason: string }[];
};

export async function importDebtors(
  organizationId: string,
  userId: string,
  rows: unknown[],
  campaignId?: string,
): Promise<ImportResult> {
  if (campaignId) {
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign) throw new Error("Campaign not found in this organization");
  }

  const existing = await db.debtor.findMany({
    where: { organizationId },
    select: { accountNumber: true },
  });
  const seen = new Set(existing.map((d) => d.accountNumber));

  const result: ImportResult = { created: 0, skipped: [] };
  for (let i = 0; i < rows.length; i++) {
    const rowNumber = i + 2; // 1-based + header row
    const parsed = importRowSchema.safeParse(rows[i]);
    if (!parsed.success) {
      const issue = parsed.error.issues[0];
      result.skipped.push({
        row: rowNumber,
        reason: `${issue?.path.join(".") || "row"}: ${issue?.message || "invalid"}`,
      });
      continue;
    }
    const data = parsed.data;
    if (seen.has(data.accountNumber)) {
      result.skipped.push({ row: rowNumber, reason: `account ${data.accountNumber} already exists` });
      continue;
    }
    const phone = normalizePhone(data.phone);
    if (!phone) {
      result.skipped.push({ row: rowNumber, reason: `phone "${data.phone}" is not a valid number` });
      continue;
    }
    seen.add(data.accountNumber);

    const dueDate =
      data.dueDate ?? new Date(Date.now() - (data.daysOverdue ?? 0) * 86_400_000);
    const daysOverdue =
      data.daysOverdue ?? Math.max(0, daysBetween(dueDate, new Date()));
    const currentBalance = data.currentBalance ?? data.originalBalance;

    const debtor = await db.debtor.create({
      data: {
        organizationId,
        firstName: data.firstName,
        lastName: data.lastName,
        accountNumber: data.accountNumber,
        phone,
        email: data.email || null,
        city: data.city || null,
        province: data.province || null,
        campaignId,
        riskScore: Math.min(95, Math.max(10, Math.round(daysOverdue / 3 + 25))),
      },
    });
    await db.debtAccount.create({
      data: {
        organizationId,
        debtorId: debtor.id,
        reference: data.accountNumber,
        creditorName: data.creditorName,
        originalBalance: data.originalBalance,
        currentBalance,
        amountPaid: Math.max(0, data.originalBalance - currentBalance),
        dueDate,
        daysOverdue,
      },
    });
    result.created++;
  }

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "debtors.imported",
    entityType: "debtor",
    entityId: campaignId ?? "batch",
    detail: { created: result.created, skipped: result.skipped.length, campaignId: campaignId ?? null },
  });
  return result;
}

export async function assignDebtorCampaign(
  organizationId: string,
  userId: string,
  debtorId: string,
  campaignId: string | null,
) {
  const debtor = await db.debtor.findFirst({ where: { id: debtorId, organizationId } });
  if (!debtor) throw new Error("Debtor not found");
  if (campaignId) {
    const campaign = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
    if (!campaign) throw new Error("Campaign not found in this organization");
  }
  const updated = await db.debtor.update({ where: { id: debtorId }, data: { campaignId } });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "debtor.campaign_assigned",
    entityType: "debtor",
    entityId: debtorId,
    detail: { from: debtor.campaignId, to: campaignId },
  });
  return updated;
}

/** Distinct campaigns for filter dropdowns. */
export async function listCampaignOptions(organizationId: string) {
  return db.campaign.findMany({
    where: { organizationId },
    select: { id: true, name: true },
    orderBy: { name: "asc" },
  });
}
