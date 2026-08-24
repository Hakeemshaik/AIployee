import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import type { PromiseDisplayStatus } from "@/lib/domain";
import { daysBetween, startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// Promise-to-pay service. Stored status is pending/fulfilled/broken/cancelled;
// the date-relative states (upcoming / due today / overdue) are derived at
// read time so they are always correct without a scheduler.
// ---------------------------------------------------------------------------

export function promiseDisplayStatus(promise: {
  status: string;
  promisedDate: Date;
}): PromiseDisplayStatus {
  if (promise.status !== "pending") return promise.status as PromiseDisplayStatus;
  const diff = daysBetween(new Date(), promise.promisedDate);
  if (diff < 0) return "overdue";
  if (diff === 0) return "due_today";
  return "upcoming";
}

export async function listPromises(
  organizationId: string,
  filters: { status?: string; campaignId?: string } = {},
) {
  const promises = await db.promiseToPay.findMany({
    where: {
      organizationId,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
    },
    include: {
      debtor: { select: { id: true, firstName: true, lastName: true, accountNumber: true } },
      campaign: { select: { id: true, name: true } },
      payments: { select: { amount: true } },
    },
    orderBy: [{ status: "asc" }, { promisedDate: "asc" }],
  });

  const rows = promises.map((p) => ({
    id: p.id,
    debtorId: p.debtor.id,
    debtorName: `${p.debtor.firstName} ${p.debtor.lastName}`,
    accountNumber: p.debtor.accountNumber,
    amount: p.amount,
    paidTowards: p.payments.reduce((s, x) => s + x.amount, 0),
    promisedDate: p.promisedDate,
    displayStatus: promiseDisplayStatus(p),
    daysOverdue:
      p.status === "pending" ? Math.max(0, -daysBetween(new Date(), p.promisedDate)) : 0,
    campaignName: p.campaign?.name ?? null,
    createdAt: p.createdAt,
  }));

  if (filters.status) return rows.filter((r) => r.displayStatus === filters.status);
  return rows;
}

export async function getPromiseStats(organizationId: string) {
  const promises = await db.promiseToPay.findMany({
    where: { organizationId },
    select: { amount: true, status: true, promisedDate: true },
  });
  const today = startOfDay(new Date());
  const pending = promises.filter((p) => p.status === "pending");
  const fulfilled = promises.filter((p) => p.status === "fulfilled");
  const broken = promises.filter((p) => p.status === "broken");
  const resolved = fulfilled.length + broken.length;
  return {
    totalPromised: promises.filter((p) => p.status !== "cancelled").reduce((s, p) => s + p.amount, 0),
    openValue: pending.reduce((s, p) => s + p.amount, 0),
    dueToday: pending.filter((p) => daysBetween(today, startOfDay(p.promisedDate)) === 0).length,
    overdue: pending.filter((p) => startOfDay(p.promisedDate) < today).length,
    fulfilled: fulfilled.length,
    broken: broken.length,
    fulfilmentRate: resolved > 0 ? fulfilled.length / resolved : 0,
  };
}

/**
 * Mark long-overdue pending promises as broken (grace period in days).
 * Called opportunistically from the promises page — replaces a cron job at
 * MVP stage and emits proper promise.broken events.
 */
export async function sweepBrokenPromises(organizationId: string, graceDays = 3) {
  const cutoff = new Date(Date.now() - graceDays * 86_400_000);
  const stale = await db.promiseToPay.findMany({
    where: { organizationId, status: "pending", promisedDate: { lt: cutoff } },
  });
  for (const promise of stale) {
    await db.promiseToPay.update({ where: { id: promise.id }, data: { status: "broken" } });
    await db.debtor.update({
      where: { id: promise.debtorId },
      data: { status: "active" },
    });
    await emitEvent({
      type: "promise.broken",
      organizationId,
      entityType: "promise",
      entityId: promise.id,
      payload: { amount: promise.amount, promisedDate: promise.promisedDate.toISOString() },
    });
    await audit({
      organizationId,
      actorType: "system",
      action: "promise.marked_broken",
      entityType: "promise",
      entityId: promise.id,
      detail: { amount: promise.amount, graceDays },
    });
  }
  return stale.length;
}

export async function cancelPromise(organizationId: string, userId: string, promiseId: string) {
  const promise = await db.promiseToPay.findFirst({ where: { id: promiseId, organizationId } });
  if (!promise) throw new Error("Promise not found");
  if (promise.status !== "pending") throw new Error("Only pending promises can be cancelled");
  await db.promiseToPay.update({ where: { id: promiseId }, data: { status: "cancelled" } });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "promise.cancelled",
    entityType: "promise",
    entityId: promiseId,
  });
}
