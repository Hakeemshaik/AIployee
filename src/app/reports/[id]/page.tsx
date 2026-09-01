import { notFound } from "next/navigation";
import { Sparkles } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, formatDateTime, money, percent } from "@/lib/format";
import { getReport } from "@/services/reports";
import { Badge, Card, PageHeader, StatCard } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { ReportActions } from "./ReportActions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Report" };

export default async function ReportDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getContext();
  const result = await getReport(ctx.organizationId, id);
  if (!result) notFound();
  const { report, content } = result;
  const snap = content?.snapshot;
  const narrative = content?.narrative;

  return (
    <div className="page-in">
      <BackLink href="/reports" label="All reports" />
      <PageHeader
        title={report.title}
        description={`${formatDate(report.periodStart)} – ${formatDate(report.periodEnd)} · generated ${formatDateTime(report.generatedAt)} by ${report.provider === "claude" ? "Claude" : "the built-in engine"}`}
        actions={<ReportActions reportId={report.id} />}
      />

      {!content || !snap || !narrative ? (
        <Card>
          <p className="text-[0.8125rem] text-ink-3">
            This report has no stored content — regenerate it to rebuild from current data.
          </p>
        </Card>
      ) : (
        <>
          <Card className="mb-4" title="Executive summary">
            <p className="flex max-w-4xl items-start gap-2 text-[0.875rem] leading-relaxed text-ink">
              <Sparkles size={15} className="mt-1 shrink-0 text-accent" />
              {narrative.executiveSummary}
            </p>
          </Card>

          <h2 className="mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
            Performance metrics
          </h2>
          <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
            <StatCard label="Outstanding" value={money(snap.totals.totalOutstanding)} />
            <StatCard label="Recovered" value={money(snap.totals.totalRecovered)} tone="good" />
            <StatCard label="Recovery rate" value={percent(snap.totals.recoveryRate)} />
            <StatCard label="Call attempts" value={String(snap.totals.totalCallAttempts)} sub={`${percent(snap.totals.connectRate, 0)} connected`} />
            <StatCard label="Debtors contacted" value={`${snap.totals.debtorsContacted}/${snap.totals.debtorCount}`} />
            <StatCard label="Payments" value={String(snap.payments.count)} sub={`avg ${money(snap.payments.averageValue)}`} />
          </div>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card title="Collection outcomes" subtitle="Connected-call outcomes in the period">
              {Object.keys(snap.outcomes).length === 0 ? (
                <p className="text-[0.8125rem] text-ink-3">No analysed calls in this period.</p>
              ) : (
                <ul className="space-y-2">
                  {Object.entries(snap.outcomes)
                    .sort((a, b) => b[1] - a[1])
                    .map(([outcome, count]) => (
                      <li key={outcome} className="flex items-center justify-between gap-3 text-[0.8125rem]">
                        <Badge value={outcome} label={label(outcome)} />
                        <span className="num font-medium text-ink">{count}</span>
                      </li>
                    ))}
                </ul>
              )}
            </Card>
            <Card title="Promise-to-pay performance">
              <dl className="grid grid-cols-2 gap-x-6">
                {[
                  ["Promises created", String(snap.promises.total)],
                  ["Committed value", money(snap.promises.totalValue)],
                  ["Fulfilled", String(snap.promises.fulfilled)],
                  ["Broken", String(snap.promises.broken)],
                  ["Still pending", String(snap.promises.pending)],
                  ["Fulfilment rate", percent(snap.promises.fulfilmentRate, 0)],
                ].map(([k, v]) => (
                  <div key={k} className="flex items-baseline justify-between border-b border-line-2 py-2">
                    <dt className="text-[0.75rem] text-ink-3">{k}</dt>
                    <dd className="num text-[0.8125rem] font-medium text-ink">{v}</dd>
                  </div>
                ))}
              </dl>
              <h3 className="mb-2 mt-5 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                Recovery by account age
              </h3>
              <ul className="space-y-1.5">
                {snap.agingBuckets.map((b) => (
                  <li key={b.bucket} className="flex items-center justify-between text-[0.78125rem] text-ink-2">
                    <span>{b.bucket} days · {b.debtors} debtors</span>
                    <span className="num">{money(b.recovered)} recovered · {percent(b.contactRate, 0)} contacted</span>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="AI insights">
              <ul className="space-y-3">
                {narrative.insights.map((f, i) => (
                  <li key={i} className="text-[0.8125rem] leading-relaxed text-ink-2">
                    <span className="font-medium text-ink">{f.title}.</span> {f.detail}
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="AI recommendations">
              <ul className="space-y-3">
                {narrative.recommendations.map((a, i) => (
                  <li key={i} className="flex items-start gap-3">
                    <Badge value={a.priority} label={label(a.priority)} />
                    <p className="text-[0.8125rem] leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">{a.title}.</span> {a.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
          </div>

          {snap.campaigns.length > 0 && (
            <Card className="mt-4" title="Campaign breakdown" pad={false}>
              <div className="scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Campaign</th>
                      <th>Status</th>
                      <th className="text-right">Debtors</th>
                      <th className="text-right">Contacted</th>
                      <th className="text-right">Promises</th>
                      <th className="text-right">Promise value</th>
                      <th className="text-right">Recovered</th>
                      <th className="text-right">Recovery rate</th>
                    </tr>
                  </thead>
                  <tbody>
                    {snap.campaigns.map((c) => (
                      <tr key={c.name}>
                        <td className="font-medium text-ink">{c.name}</td>
                        <td><Badge value={c.status} label={label(c.status)} /></td>
                        <td className="num text-right">{c.debtors}</td>
                        <td className="num text-right">{c.contacted}</td>
                        <td className="num text-right">{c.promises}</td>
                        <td className="num text-right">{money(c.promiseValue)}</td>
                        <td className="num text-right text-good">{money(c.recovered)}</td>
                        <td className="num text-right">{percent(c.recoveryRate)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </Card>
          )}
        </>
      )}
    </div>
  );
}
