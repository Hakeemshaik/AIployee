import Link from "next/link";
import { getContext } from "@/lib/auth";
import { db } from "@/lib/db";
import { label, PAYMENT_METHODS } from "@/lib/domain";
import { formatDate, money, moneyExact, percent } from "@/lib/format";
import { listCampaignOptions } from "@/services/debtors";
import { getPaymentStats, listPayments } from "@/services/payments";
import { Badge, EmptyState, GlassCard, PageHeader, StatCard } from "@/components/ui";
import { ParamSelect } from "@/components/actions/ParamSelect";
import { RecordPaymentButton } from "./RecordPayment";

export const dynamic = "force-dynamic";
export const metadata = { title: "Payments" };

export default async function PaymentsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getContext();
  const [stats, payments, campaigns, debtors] = await Promise.all([
    getPaymentStats(ctx.organizationId),
    listPayments(ctx.organizationId, { campaignId: params.campaign, method: params.method }),
    listCampaignOptions(ctx.organizationId),
    db.debtor.findMany({
      where: { organizationId: ctx.organizationId },
      select: { id: true, firstName: true, lastName: true, accountNumber: true },
      orderBy: { firstName: "asc" },
    }),
  ]);

  return (
    <div className="page-in">
      <PageHeader
        title="Payments"
        description="Recovered money, linked back to promises and campaigns."
        actions={
          <RecordPaymentButton
            debtors={debtors.map((d) => ({
              id: d.id,
              name: `${d.firstName} ${d.lastName}`,
              accountNumber: d.accountNumber,
            }))}
          />
        }
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Payments today" value={money(stats.todayValue)} sub={`${stats.todayCount} payment${stats.todayCount === 1 ? "" : "s"}`} />
        <StatCard label="This month" value={money(stats.monthValue)} />
        <StatCard label="Total recovered" value={money(stats.totalRecovered)} tone="good" />
        <StatCard label="Average payment" value={money(stats.averagePayment)} />
        <StatCard label="Recovery rate" value={percent(stats.recoveryRate)} sub="recovered vs total book" />
      </div>

      <div className="glass-subtle mb-4 flex flex-wrap items-center gap-2 p-3">
        <ParamSelect
          param="method"
          placeholder="All methods"
          options={PAYMENT_METHODS.map((m) => ({ value: m, label: label(m) }))}
        />
        <ParamSelect
          param="campaign"
          placeholder="All campaigns"
          options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>

      <GlassCard pad={false}>
        {payments.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No payments match"
              hint="Record a payment manually or let them arrive from your payment reconciliation feed."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Debtor</th>
                  <th className="text-right">Amount</th>
                  <th>Date</th>
                  <th>Method</th>
                  <th>Reference</th>
                  <th>Campaign</th>
                  <th>Promise linked</th>
                  <th>Status</th>
                </tr>
              </thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/debtors/${p.debtor.id}`} className="font-medium text-ink hover:text-accent">
                        {p.debtor.firstName} {p.debtor.lastName}
                      </Link>
                      <span className="num ml-2 text-[0.6875rem] text-ink-3">{p.debtor.accountNumber}</span>
                    </td>
                    <td className="num text-right font-medium text-[#5fc46a]">{moneyExact(p.amount)}</td>
                    <td>{formatDate(p.paidAt)}</td>
                    <td>{label(p.method)}</td>
                    <td className="num text-ink-3">{p.reference ?? "—"}</td>
                    <td className="max-w-[170px] truncate text-ink-3">{p.campaign?.name ?? "—"}</td>
                    <td>
                      {p.promise ? (
                        <Badge value="fulfilled" label={`${money(p.promise.amount)} · ${formatDate(p.promise.promisedDate)}`} />
                      ) : (
                        <span className="text-ink-3">Unlinked</span>
                      )}
                    </td>
                    <td><Badge value={p.status} label={label(p.status)} /></td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </GlassCard>
    </div>
  );
}
