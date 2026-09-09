import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { PAYMENT_METHODS, type PromiseDisplayStatus } from "@/lib/domain";
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
    method: p.method,
    bank: p.bank,
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


// ---------------------------------------------------------------------------
// Capturing a promise by hand.
//
// Until now a promise could only be born on a call, which is wrong the moment
// somebody phones in, replies to a message, or tells a collector at the
// counter. The commitment is the single most valuable thing this business
// collects, and there was no way to write one down.
// ---------------------------------------------------------------------------

export const createPromiseSchema = z.object({
  debtorId: z.string().min(1),
  amount: z.coerce.number().positive().max(10_000_000),
  promisedDate: z.coerce.date(),
  method: z.enum(PAYMENT_METHODS).optional(),
  bank: z.string().max(60).optional(),
  note: z.string().max(500).optional(),
});

export type CreatePromiseInput = z.infer<typeof createPromiseSchema>;

/** A date somebody could actually pay on: today or later, within a year. */
function checkDate(promisedDate: Date): void {
  const day = startOfDay(promisedDate);
  const today = startOfDay(new Date());
  if (day < today) {
    throw new Error("A promise cannot be dated in the past");
  }
  if (daysBetween(today, day) > 365) {
    throw new Error("A promise more than a year out is not a promise");
  }
}

export async function createPromise(
  organizationId: string,
  userId: string,
  input: CreatePromiseInput,
) {
  const data = createPromiseSchema.parse(input);
  checkDate(data.promisedDate);

  const debtor = await db.debtor.findFirst({
    where: { id: data.debtorId, organizationId },
    select: { id: true, campaignId: true, status: true },
  });
  if (!debtor) throw new Error("Debtor not found in this organization");

  // One live promise at a time. Two open commitments on one account means the
  // follow-up, the dialling guard and the "promised, unpaid" figure are all
  // reading a number nobody agreed to.
  const existing = await db.promiseToPay.findFirst({
    where: { organizationId, debtorId: debtor.id, status: "pending" },
    orderBy: { promisedDate: "asc" },
  });
  if (existing) {
    throw new Error(
      "This account already has an open promise. Cancel it first, or record a payment against it.",
    );
  }

  const promise = await db.promiseToPay.create({
    data: {
      organizationId,
      debtorId: debtor.id,
      campaignId: debtor.campaignId,
      amount: data.amount,
      promisedDate: data.promisedDate,
      method: data.method,
      bank: data.bank,
      paymentPlan: data.note ? JSON.stringify({ note: data.note }) : null,
      status: "pending",
    },
  });

  // An account with a live promise is not dialled, so the status has to move
  // with the promise or the guard never sees it.
  await db.debtor.update({
    where: { id: debtor.id },
    data: { status: "promise" },
  });

  await emitEvent({
    type: "promise.created",
    organizationId,
    entityType: "promise",
    entityId: promise.id,
    payload: {
      amount: promise.amount,
      promisedDate: promise.promisedDate.toISOString(),
      source: "manual",
    },
  });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "promise.created",
    entityType: "promise",
    entityId: promise.id,
    detail: {
      debtorId: debtor.id,
      amount: promise.amount,
      promisedDate: promise.promisedDate.toISOString(),
      method: promise.method,
      bank: promise.bank,
    },
  });

  return promise;
}
