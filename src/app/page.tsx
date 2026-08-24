import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDateTime, money, percent } from "@/lib/format";
import { getDashboardData } from "@/services/dashboard";
import { GlassCard, PageHeader, StatCard } from "@/components/ui";
import {
  ContactActivityChart,
  HBarChart,
  PaymentsBarChart,
  PromiseConversionChart,
  RecoveryTrendChart,
} from "@/components/charts";
import { RefreshInsightsButton } from "@/components/actions/RefreshInsights";

export const dynamic = "force-dynamic";

export default async function DashboardPage() {
  const ctx = await getContext();
  const data = await getDashboardData(ctx.organizationId);
  const m = data.metrics;
  const insight = data.insight;

  return (
    <div className="page-in">
      <PageHeader
        title="Dashboard"
        description="Executive view of the collection operation — last 30 days unless stated."
      />

      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total Outstanding" value={money(m.totalOutstanding)} sub="across the full book" />
        <StatCard label="Total Recovered" value={money(m.totalRecovered)} tone="good" sub="all time" />
        <StatCard label="Recovery Rate" value={percent(m.recoveryRate)} sub="recovered vs total book" />
        <StatCard label="Debtors Contacted" value={String(m.debtorsContacted)} sub="last 30 days" />
        <StatCard label="Successful Contacts" value={String(m.successfulContacts)} sub="reached & spoke" />
        <StatCard label="Open Promises" value={String(m.promisesOpen)} sub="awaiting payment" />
        <StatCard label="Promise Value" value={money(m.promiseValue)} sub="committed, not yet paid" />
        <StatCard label="Payments Received" value={String(m.paymentsReceived)} sub={`${money(m.paymentsValue)} in 30 days`} />
        <StatCard label="Active Campaigns" value={String(m.activeCampaigns)} sub="dialling now" />
        <StatCard
          label="Connect Rate"
          value={
            data.contactSeries.reduce((s, d) => s + d.attempts, 0) > 0
              ? percent(
                  data.contactSeries.reduce((s, d) => s + d.connected, 0) /
                    data.contactSeries.reduce((s, d) => s + d.attempts, 0),
                )
              : "—"
          }
          sub="of call attempts"
        />
      </div>

      {/* AI Collection Intelligence */}
      <GlassCard
        className="mb-5"
        title="AI Collection Intelligence"
        subtitle={
          insight
            ? `Generated ${formatDateTime(insight.generatedAt)} · ${insight.provider === "claude" ? "Claude" : "built-in engine"}`
            : "No analysis generated yet"
        }
        actions={<RefreshInsightsButton scope="dashboard" />}
      >
        {insight ? (
          <div>
            <p className="mb-4 flex items-start gap-2 text-[0.875rem] leading-relaxed text-ink">
              <Sparkles size={15} className="mt-1 shrink-0 text-accent" />
              {insight.content.headline}
            </p>
            <div className="grid gap-5 lg:grid-cols-2">
              <div>
                <h3 className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                  Key findings
                </h3>
                <ul className="space-y-2.5">
                  {insight.content.keyFindings.slice(0, 3).map((f, i) => (
                    <li key={i} className="text-[0.8125rem] leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">{f.title}.</span> {f.detail}
                    </li>
                  ))}
                </ul>
              </div>
              <div>
                <h3 className="mb-2 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                  Recommended actions
                </h3>
                <ul className="space-y-2.5">
                  {insight.content.recommendedActions.slice(0, 3).map((a, i) => (
                    <li key={i} className="flex gap-2.5 text-[0.8125rem] leading-relaxed text-ink-2">
                      <span
                        className={`mt-1.5 h-1.5 w-1.5 shrink-0 rounded-full ${
                          a.priority === "high" ? "bg-[#ec835a]" : a.priority === "medium" ? "bg-[#fab219]" : "bg-[#3987e5]"
                        }`}
                        title={`${label(a.priority)} priority`}
                      />
                      <span>
                        <span className="font-medium text-ink">{a.title}.</span> {a.detail}
                      </span>
                    </li>
                  ))}
                </ul>
              </div>
            </div>
            <p className="mt-4 text-[0.71875rem] text-ink-3">
              Full analysis on the{" "}
              <Link href="/insights" className="text-accent hover:underline">
                AI Insights
              </Link>{" "}
              page.
            </p>
          </div>
        ) : (
          <p className="text-[0.8125rem] text-ink-2">
            Use Regenerate to analyse the last 30 days of collection activity.
          </p>
        )}
      </GlassCard>

      {/* Charts */}
      <div className="grid gap-4 lg:grid-cols-2">
        <GlassCard title="Recovery over time" subtitle="Cumulative rand value recovered, last 30 days">
          <RecoveryTrendChart data={data.recoverySeries} />
        </GlassCard>
        <GlassCard title="Contact success" subtitle="Daily call attempts and connections">
          <ContactActivityChart data={data.contactSeries} />
        </GlassCard>
        <GlassCard title="Promise-to-pay conversion" subtitle="Weekly promises created vs fulfilled">
          <PromiseConversionChart data={data.promiseSeries} />
        </GlassCard>
        <GlassCard title="Payments received" subtitle="Daily rand value received, last 30 days">
          <PaymentsBarChart data={data.recoverySeries} />
        </GlassCard>
        <GlassCard title="Campaign performance" subtitle="Rand recovered per campaign">
          {data.campaignSeries.length ? (
            <HBarChart
              money
              data={data.campaignSeries.map((c) => ({ label: c.name, value: c.recovered }))}
            />
          ) : (
            <p className="py-8 text-center text-[0.8125rem] text-ink-3">No campaign data yet.</p>
          )}
        </GlassCard>
        <GlassCard title="Collection outcomes" subtitle="Connected-call outcomes, last 30 days">
          {data.outcomeSeries.length ? (
            <HBarChart
              data={data.outcomeSeries.slice(0, 8).map((o) => ({ label: label(o.outcome), value: o.count }))}
            />
          ) : (
            <p className="py-8 text-center text-[0.8125rem] text-ink-3">No analysed calls yet.</p>
          )}
        </GlassCard>
      </div>
    </div>
  );
}
