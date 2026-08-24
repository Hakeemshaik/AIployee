import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { PAYMENT_METHODS } from "@/lib/domain";
import { startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// Payment service — recording a payment drives the whole downstream workflow:
// account balances update, linked promises resolve, debtor status moves, and
// payment.received / promise.fulfilled events fire.
// ---------------------------------------------------------------------------

export async function listPayments(
  organizationId: string,
  filters: { campaignId?: string; method?: string } = {},
  take = 200,
) {
  return db.payment.findMany({
    where: {
      organizationId,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.method ? { method: filters.method } : {}),
    },
    include: {
      debtor: { select: { id: true, firstName: true, lastName: true, accountNumber: true } },
      campaign: { select: { id: true, name: true } },
      promise: { select: { id: true, amount: true, promisedDate: true } },
    },
    orderBy: { paidAt: "desc" },
    take,
  });
}

export async function getPaymentStats(organizationId: string) {
  const [payments, accounts] = await Promise.all([
    db.payment.findMany({
      where: { organizationId, status: "completed" },
      select: { amount: true, paidAt: true },
    }),
    db.debtAccount.findMany({
      where: { organizationId },
      select: { currentBalance: true },
    }),
  ]);
  const today = startOfDay(new Date());
  const monthStart = new Date(today.getFullYear(), today.getMonth(), 1);
  const totalRecovered = payments.reduce((s, p) => s + p.amount, 0);
  const outstanding = accounts.reduce((s, a) => s + a.currentBalance, 0);
  return {
    todayValue: payments.filter((p) => p.paidAt >= today).reduce((s, p) => s + p.amount, 0),
    todayCount: payments.filter((p) => p.paidAt >= today).length,
    monthValue: payments.filter((p) => p.paidAt >= monthStart).reduce((s, p) => s + p.amount, 0),
    totalRecovered,
    averagePayment: payments.length ? totalRecovered / payments.length : 0,
    recoveryRate: outstanding + totalRecovered > 0 ? totalRecovered / (outstanding + totalRecovered) : 0,
  };
}

export const recordPaymentSchema = z.object({
  debtorId: z.string().min(1),
  amount: z.coerce.number().positive().max(10_000_000),
  paidAt: z.coerce.date().default(() => new Date()),
  method: z.enum(PAYMENT_METHODS).default("eft"),
  reference: z.string().max(120).optional(),
  promiseId: z.string().optional(),
});

export async function recordPayment(
  organizationId: string,
  actor: { type: "user" | "integration" | "system"; id?: string },
  input: z.infer<typeof recordPaymentSchema>,
) {
  const data = recordPaymentSchema.parse(input);

  // Tenant isolation: every referenced entity must belong to this org.
  const debtor = await db.debtor.findFirst({
    where: { id: data.debtorId, organizationId },
    include: { accounts: { orderBy: { createdAt: "asc" } } },
  });
  if (!debtor) throw new Error("Debtor not found in this organization");

  const promise = data.promiseId
    ? await db.promiseToPay.findFirst({ where: { id: data.promiseId, organizationId } })
    : await db.promiseToPay.findFirst({
        where: { organizationId, debtorId: debtor.id, status: "pending" },
        orderBy: { promisedDate: "asc" },
      });

  const account = debtor.accounts[0] ?? null;

  const payment = await db.payment.create({
    data: {
      organizationId,
      debtorId: debtor.id,
      debtAccountId: account?.id,
      campaignId: debtor.campaignId,
      promiseId: promise?.id,
      amount: data.amount,
      paidAt: data.paidAt,
      method: data.method,
      reference: data.reference,
      status: "completed",
    },
  });

  if (account) {
    await db.debtAccount.update({
      where: { id: account.id },
      data: {
        currentBalance: Math.max(0, account.currentBalance - data.amount),
        amountPaid: account.amountPaid + data.amount,
      },
    });
  }

  await emitEvent({
    type: "payment.received",
    organizationId,
    entityType: "payment",
    entityId: payment.id,
    payload: { debtorId: debtor.id, amount: data.amount, method: data.method },
  });

  // Resolve the linked promise when payments cover it.
  if (promise) {
    const paidTowards = await db.payment.aggregate({
      where: { organizationId, promiseId: promise.id, status: "completed" },
      _sum: { amount: true },
    });
    if ((paidTowards._sum.amount ?? 0) >= promise.amount * 0.95) {
      await db.promiseToPay.update({
        where: { id: promise.id },
        data: { status: "fulfilled", fulfilledAt: data.paidAt },
      });
      await emitEvent({
        type: "promise.fulfilled",
        organizationId,
        entityType: "promise",
        entityId: promise.id,
        payload: { debtorId: debtor.id, amount: promise.amount },
      });
    }
  }

  // Move the debtor's status forward.
  const remaining = account ? Math.max(0, account.currentBalance - data.amount) : 0;
  await db.debtor.update({
    where: { id: debtor.id },
    data: { status: remaining <= 0 ? "paid" : debtor.status === "promise" ? "arrangement" : debtor.status },
  });

  await audit({
    organizationId,
    actorType: actor.type,
    actorId: actor.id,
    action: "payment.recorded",
    entityType: "payment",
    entityId: payment.id,
    detail: { amount: data.amount, method: data.method, promiseId: promise?.id ?? null },
  });

  return payment;
}
