import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, hasRole } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, money, percent } from "@/lib/format";
import { getCampaign } from "@/services/campaigns";
import { listDebtors } from "@/services/debtors";
import { BackLink, Badge, GlassCard, Meta, PageHeader, StatCard } from "@/components/ui";
import { CampaignActivityChart, HBarChart, PaymentsBarChart } from "@/components/charts";
import { StatusControls } from "./StatusControls";
import { JobixExport } from "./JobixExport";
import { LiveCampaign } from "./LiveCampaign";
import { getCampaignLiveState } from "@/services/campaign-live";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaign" };

export default async function CampaignDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getContext();
  const result = await getCampaign(ctx.organizationId, id);
  if (!result) notFound();
  const { campaign, metrics, series } = result;
  const [debtors, live] = await Promise.all([
    listDebtors(ctx.organizationId, { campaignId: id }),
    getCampaignLiveState(ctx.organizationId, id),
  ]);
  const canControl = hasRole(ctx, ["admin", "manager"]);

  return (
    <div className="page-in">
      <BackLink href="/campaigns" label="All campaigns" />
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            <JobixExport campaignId={campaign.id} />
            <StatusControls campaignId={campaign.id} status={campaign.status} />
          </div>
        }
      />

      {live && (
        <div className="mb-5">
          <LiveCampaign
            campaignId={campaign.id}
            canControl={canControl}
            initial={JSON.parse(JSON.stringify(live))}
          />
        </div>
      )}

      <h2 className="mb-3 text-[0.6875rem] font-medium uppercase tracking-[0.07em] text-ink-3">
        Recovery performance
      </h2>
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Total debt" value={money(metrics.totalDebt)} />
        <StatCard label="Debtors" value={String(metrics.totalDebtors)} />
        <StatCard label="Contacted" value={String(metrics.contacted)} sub={`${metrics.connected} connected`} />
        <StatCard label="Promises" value={String(metrics.promises)} sub={money(metrics.promiseValue)} />
        <StatCard label="Recovered" value={money(metrics.recovered)} tone="good" sub={`${percent(metrics.recoveryRate)} recovery rate · ${metrics.payments} payments`} />
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-3">
        <GlassCard title="Campaign performance" subtitle="Daily activity, last 30 days" className="xl:col-span-2">
          <CampaignActivityChart data={series} />
        </GlassCard>
        <GlassCard title="Configuration">
          <dl>
            <Meta label="AI agent">
              {campaign.agent ? (
                <Link href={`/agents/${campaign.agent.id}`} className="text-accent hover:underline">
                  {campaign.agent.name}
                </Link>
              ) : (
                "Not assigned"
              )}
            </Meta>
            <Meta label="Strategy">{label(campaign.strategy)}</Meta>
            <Meta label="Target segment">
              <span className="block max-w-[220px] text-right leading-snug">{campaign.segment ?? "—"}</span>
            </Meta>
            <Meta label="Start date">{formatDate(campaign.startDate)}</Meta>
            <Meta label="End date">{formatDate(campaign.endDate)}</Meta>
            <Meta label="Calling hours">{campaign.callingHoursStart}–{campaign.callingHoursEnd}</Meta>
            <Meta label="Max attempts">{campaign.maxAttempts}</Meta>
            <Meta label="Retry interval">{campaign.retryIntervalHours}h</Meta>
          </dl>
        </GlassCard>
      </div>

      <div className="mb-4 grid gap-4 xl:grid-cols-2">
        <GlassCard
          title="Collection funnel"
          subtitle="Debtors at each stage of the campaign workflow"
        >
          <HBarChart
            height={210}
            data={[
              { label: "In campaign", value: metrics.totalDebtors },
              { label: "Contacted", value: metrics.contacted },
              { label: "Connected", value: metrics.connected },
              { label: "Promised", value: metrics.promisedDebtors },
              { label: "Paid", value: metrics.paidDebtors },
            ]}
          />
        </GlassCard>
        <GlassCard title="Recovered per day" subtitle="Rand value received, last 30 days">
          <PaymentsBarChart data={series.map((s) => ({ date: s.date, received: s.recovered }))} />
        </GlassCard>
      </div>

      <GlassCard title={`Debtors in campaign (${debtors.length})`} pad={false}>
        {debtors.length === 0 ? (
          <p className="p-8 text-center text-[0.8125rem] text-ink-3">
            No debtors assigned yet. Assign debtors from the Debtors page or via import.
          </p>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Name</th>
                  <th>Account</th>
                  <th className="text-right">Outstanding</th>
                  <th className="text-right">Days overdue</th>
                  <th>Last outcome</th>
                  <th>Status</th>
                  <th>Risk</th>
                </tr>
              </thead>
              <tbody>
                {debtors.map((d) => (
                  <tr key={d.id}>
                    <td>
                      <Link href={`/debtors/${d.id}`} className="font-medium text-ink hover:text-accent">
                        {d.name}
                      </Link>
                    </td>
                    <td className="num text-ink-3">{d.accountNumber}</td>
                    <td className="num text-right font-medium text-ink">{money(d.outstanding)}</td>
                    <td className="num text-right">{d.daysOverdue}</td>
                    <td>{d.lastOutcome ? <Badge value={d.lastOutcome} label={label(d.lastOutcome)} /> : "—"}</td>
                    <td><Badge value={d.status} label={label(d.status)} /></td>
                    <td><Badge value={`risk_${d.riskBand}`} label={label(d.riskBand)} /></td>
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
