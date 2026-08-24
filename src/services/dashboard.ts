import { db } from "@/lib/db";
import { startOfDay } from "@/lib/format";
import { getLatestInsight } from "@/services/insights";

// ---------------------------------------------------------------------------
// Dashboard service — top metrics, 30-day chart series, and the latest
// AI Collection Intelligence block.
// ---------------------------------------------------------------------------

export async function getDashboardData(organizationId: string) {
  const since = new Date(Date.now() - 30 * 86_400_000);

  const [accounts, payments, calls, promises, activeCampaigns, campaignsWithMetrics, analyses, insight] =
    await Promise.all([
      db.debtAccount.findMany({
        where: { organizationId },
        select: { currentBalance: true },
      }),
      db.payment.findMany({
        where: { organizationId, status: "completed" },
        select: { amount: true, paidAt: true },
      }),
      db.call.findMany({
        where: { organizationId, startedAt: { gte: since } },
        select: { status: true, startedAt: true, debtorId: true },
      }),
      db.promiseToPay.findMany({
        where: { organizationId },
        select: { amount: true, status: true, createdAt: true, fulfilledAt: true },
      }),
      db.campaign.count({ where: { organizationId, status: "active" } }),
      db.campaign.findMany({
        where: { organizationId, status: { in: ["active", "paused", "completed"] } },
        select: {
          name: true,
          status: true,
          debtors: { select: { accounts: { select: { currentBalance: true } } } },
          payments: { where: { status: "completed" }, select: { amount: true } },
          promises: { select: { amount: true } },
        },
      }),
      db.callAnalysis.findMany({
        where: { organizationId, createdAt: { gte: since } },
        select: { outcome: true },
      }),
      getLatestInsight(organizationId, "dashboard"),
    ]);

  const totalOutstanding = accounts.reduce((s, a) => s + a.currentBalance, 0);
  const totalRecovered = payments.reduce((s, p) => s + p.amount, 0);
  const openPromises = promises.filter((p) => p.status === "pending");

  const metrics = {
    totalOutstanding,
    totalRecovered,
    recoveryRate: totalOutstanding + totalRecovered > 0 ? totalRecovered / (totalOutstanding + totalRecovered) : 0,
    debtorsContacted: new Set(calls.map((c) => c.debtorId)).size,
    successfulContacts: new Set(calls.filter((c) => c.status === "completed").map((c) => c.debtorId)).size,
    promisesOpen: openPromises.length,
    promiseValue: openPromises.reduce((s, p) => s + p.amount, 0),
    paymentsReceived: payments.filter((p) => p.paidAt >= since).length,
    paymentsValue: payments.filter((p) => p.paidAt >= since).reduce((s, p) => s + p.amount, 0),
    activeCampaigns,
  };

  // --- 30-day daily series ---
  const days: Date[] = [];
  for (let i = 29; i >= 0; i--) days.push(startOfDay(new Date(Date.now() - i * 86_400_000)));

  let cumulative = payments.filter((p) => p.paidAt < days[0]).reduce((s, p) => s + p.amount, 0);
  const recoverySeries = days.map((day) => {
    const next = new Date(day.getTime() + 86_400_000);
    const dayValue = payments
      .filter((p) => p.paidAt >= day && p.paidAt < next)
      .reduce((s, p) => s + p.amount, 0);
    cumulative += dayValue;
    return {
      date: day.toISOString().slice(0, 10),
      received: Math.round(dayValue),
      cumulative: Math.round(cumulative),
    };
  });

  const contactSeries = days.map((day) => {
    const next = new Date(day.getTime() + 86_400_000);
    const dayCalls = calls.filter((c) => c.startedAt >= day && c.startedAt < next);
    const connected = dayCalls.filter((c) => c.status === "completed").length;
    return {
      date: day.toISOString().slice(0, 10),
      attempts: dayCalls.length,
      connected,
    };
  });

  // Weekly promise-to-pay conversion: created vs fulfilled.
  const promiseSeries: { week: string; created: number; fulfilled: number }[] = [];
  for (let w = 3; w >= 0; w--) {
    const weekStart = startOfDay(new Date(Date.now() - (w * 7 + 6) * 86_400_000));
    const weekEnd = new Date(weekStart.getTime() + 7 * 86_400_000);
    promiseSeries.push({
      week: `${weekStart.getDate()}/${weekStart.getMonth() + 1}`,
      created: promises.filter((p) => p.createdAt >= weekStart && p.createdAt < weekEnd).length,
      fulfilled: promises.filter(
        (p) => p.fulfilledAt && p.fulfilledAt >= weekStart && p.fulfilledAt < weekEnd,
      ).length,
    });
  }

  const campaignSeries = campaignsWithMetrics
    .map((c) => {
      const outstanding = c.debtors.reduce(
        (s, d) => s + d.accounts.reduce((s2, a) => s2 + a.currentBalance, 0),
        0,
      );
      const recovered = c.payments.reduce((s, p) => s + p.amount, 0);
      return {
        name: c.name,
        status: c.status,
        recovered: Math.round(recovered),
        outstanding: Math.round(outstanding),
        recoveryRate: outstanding + recovered > 0 ? recovered / (outstanding + recovered) : 0,
      };
    })
    .sort((a, b) => b.recovered - a.recovered)
    .slice(0, 6);

  const outcomeCounts: Record<string, number> = {};
  for (const a of analyses) outcomeCounts[a.outcome] = (outcomeCounts[a.outcome] ?? 0) + 1;
  const outcomeSeries = Object.entries(outcomeCounts)
    .sort((a, b) => b[1] - a[1])
    .map(([outcome, count]) => ({ outcome, count }));

  return {
    metrics,
    recoverySeries,
    contactSeries,
    promiseSeries,
    campaignSeries,
    outcomeSeries,
    insight,
  };
}
