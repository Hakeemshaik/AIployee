import Link from "next/link";
import { getContext } from "@/lib/auth";
import { label, PROMISE_DISPLAY_STATUSES } from "@/lib/domain";
import { formatDate, money, percent } from "@/lib/format";
import { listCampaignOptions } from "@/services/debtors";
import { getPromiseStats, listPromises } from "@/services/promises";
import { Badge, EmptyState, GlassCard, PageHeader, StatCard } from "@/components/ui";
import { ParamSelect } from "@/components/actions/ParamSelect";
import { CancelPromiseButton, SweepButton } from "./Actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Promises to pay" };

export default async function PromisesPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getContext();
  const [stats, rows, campaigns] = await Promise.all([
    getPromiseStats(ctx.organizationId),
    listPromises(ctx.organizationId, { status: params.status, campaignId: params.campaign }),
    listCampaignOptions(ctx.organizationId),
  ]);

  return (
    <div className="page-in">
      <PageHeader
        title="Promises to pay"
        description="Every commitment captured on calls, tracked to fulfilment."
        actions={<SweepButton />}
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <StatCard label="Total promised" value={money(stats.totalPromised)} sub={`${money(stats.openValue)} still open`} />
        <StatCard label="Due today" value={String(stats.dueToday)} />
        <StatCard label="Overdue" value={String(stats.overdue)} tone={stats.overdue > 0 ? "critical" : undefined} />
        <StatCard label="Fulfilled" value={String(stats.fulfilled)} tone="good" />
        <StatCard label="Broken" value={String(stats.broken)} tone={stats.broken > 0 ? "critical" : undefined} />
        <StatCard label="Fulfilment rate" value={percent(stats.fulfilmentRate, 0)} sub="of resolved promises" />
      </div>

      <div className="glass-subtle mb-4 flex flex-wrap items-center gap-2 p-3">
        <ParamSelect
          param="status"
          placeholder="All statuses"
          options={PROMISE_DISPLAY_STATUSES.map((s) => ({ value: s, label: label(s) }))}
        />
        <ParamSelect
          param="campaign"
          placeholder="All campaigns"
          options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>

      <GlassCard pad={false}>
        {rows.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No promises match"
              hint="Promises are created automatically when the AI extracts a commitment from a call."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Debtor</th>
                  <th className="text-right">Promised amount</th>
                  <th className="text-right">Paid towards</th>
                  <th>Promise date</th>
                  <th>Status</th>
                  <th className="text-right">Days overdue</th>
                  <th>Campaign</th>
                  <th className="text-right">Action</th>
                </tr>
              </thead>
              <tbody>
                {rows.map((p) => (
                  <tr key={p.id}>
                    <td>
                      <Link href={`/debtors/${p.debtorId}`} className="font-medium text-ink hover:text-accent">
                        {p.debtorName}
                      </Link>
                      <span className="num ml-2 text-[0.6875rem] text-ink-3">{p.accountNumber}</span>
                    </td>
                    <td className="num text-right font-medium text-ink">{money(p.amount)}</td>
                    <td className="num text-right">{p.paidTowards > 0 ? money(p.paidTowards) : "—"}</td>
                    <td>{formatDate(p.promisedDate)}</td>
                    <td><Badge value={p.displayStatus} label={label(p.displayStatus)} /></td>
                    <td className="num text-right">{p.daysOverdue > 0 ? p.daysOverdue : "—"}</td>
                    <td className="max-w-[180px] truncate text-ink-3">{p.campaignName ?? "—"}</td>
                    <td className="text-right">
                      {["upcoming", "due_today", "overdue"].includes(p.displayStatus) ? (
                        <CancelPromiseButton promiseId={p.id} />
                      ) : (
                        "—"
                      )}
                    </td>
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
