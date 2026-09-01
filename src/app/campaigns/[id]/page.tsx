import Link from "next/link";
import { Workflow } from "lucide-react";
import { notFound } from "next/navigation";
import { getContext, hasRole } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, money, percent } from "@/lib/format";
import { getCampaign } from "@/services/campaigns";
import { listDebtors } from "@/services/debtors";
import { Badge, Card, Disclosure, Meta, PageHeader, StatCard } from "@/components/ui";
import { BackLink } from "@/components/BackLink";
import { CampaignActivityChart, HBarChart } from "@/components/charts";
import { StatusControls } from "./StatusControls";
import { LiveCampaign } from "./LiveCampaign";
import { LaunchPanel } from "./LaunchPanel";
import { getCampaignLiveState } from "@/services/campaign-live";
import { campaignCallLog } from "@/services/campaign-calls";
import { BUCKET_EXPLANATIONS, BUCKET_LABELS } from "@/services/analytics/classify";
import { CampaignCalls, type CampaignCallsPayload } from "./CampaignCalls";
import { BookImporter } from "@/components/BookImporter";

/**
 * The page is a sequence — add accounts, send the list, read the results — and
 * it did not look like one. Numbering the sections is the cheapest way to make
 * the order of operations obvious to someone opening a campaign for the first
 * time.
 */
function StepHeading({ number, title, note }: { number: number; title: string; note: string }) {
  return (
    <div className="mb-3 mt-7 flex items-center gap-3 border-t border-line-2 pt-5 first:mt-0 first:border-0 first:pt-0">
      <span className="num flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-accent/45 bg-accent-soft text-[0.6875rem] font-medium text-accent">
        {number}
      </span>
      <div className="min-w-0">
        <h2 className="text-[0.875rem] font-semibold tracking-tight text-ink">{title}</h2>
        <p className="text-[0.71875rem] leading-snug text-ink-3">{note}</p>
      </div>
    </div>
  );
}

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
  const [debtors, live, callLog] = await Promise.all([
    listDebtors(ctx.organizationId, { campaignId: id }),
    getCampaignLiveState(ctx.organizationId, id),
    campaignCallLog(ctx.organizationId, id),
  ]);
  const canControl = hasRole(ctx, ["admin", "manager"]);
  // Empty charts are decoration. Draw them once there is something in them.
  const hasActivity = series.some((day) => day.attempts > 0 || day.connected > 0 || day.promises > 0);

  return (
    <div className="page-in">
      <BackLink href="/campaigns" label="All campaigns" />
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
            {/* The engine: paste → rounds → report, end to end. The manual
                launch panel below stays for one-off sends; the engine is the
                repeatable workflow. */}
            <Link href={`/campaigns/${campaign.id}/engine`} className="btn btn-primary">
              <Workflow size={14} /> Campaign engine
            </Link>
            {/* A draft campaign has nothing to press up here on purpose: the
                only thing that starts a run is step 2, and a button in the
                header could only flip a status without dialling anyone. */}
            {campaign.status === "draft" && (
              <span className="text-[0.71875rem] text-ink-3">
                Send the dialling list in step 2 below to start calling.
              </span>
            )}
            <StatusControls campaignId={campaign.id} status={campaign.status} />
          </div>
        }
      />

      {/* Four numbers, in the order somebody asks them: how big is it, who
          did we reach, what did they commit, what came back. The other eight
          the page used to open with are in the detail section at the bottom. */}
      <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
        <StatCard
          i={0}
          label="Accounts"
          value={String(metrics.totalDebtors)}
          sub={`${money(metrics.totalDebt)} book value`}
        />
        <StatCard
          i={1}
          label="Reached"
          value={String(metrics.connected)}
          sub={`of ${metrics.contacted} contacted`}
        />
        <StatCard
          i={2}
          label="Promised"
          value={money(metrics.promiseValue)}
          sub={`${metrics.promises} promise${metrics.promises === 1 ? "" : "s"} to pay`}
        />
        <StatCard
          hero
          i={3}
          label="Recovered"
          value={money(metrics.recovered)}
          sub={`${percent(metrics.recoveryRate)} of the book · ${metrics.payments} payment${metrics.payments === 1 ? "" : "s"}`}
        />
      </div>


      {/* What is happening right now: three moving counters, the event feed
          and the redial lists. Before a campaign has ever dialled they are all
          zero, which is a screenful of nothing above the actual work, so it
          appears once there is something live to show. */}
      {live && (live.status === "running" || live.totals.attempted > 0) && (
        <div className="mb-5">
          <LiveCampaign
            campaignId={campaign.id}
            canControl={canControl}
            initial={JSON.parse(JSON.stringify(live))}
          />
        </div>
      )}

      <StepHeading
        number={1}
        title="Accounts in this campaign"
        note="Upload the client's book, or assign accounts already on the platform."
      />
      {canControl && (
        <Card
          title="Add accounts to this campaign"
          subtitle="Upload the client's file in any format — reviewed in full before anything is written"
          className="mb-4"
        >
          <BookImporter fixedCampaign={{ id: campaign.id, name: campaign.name }} />
        </Card>
      )}

      <Card title={`Debtors in campaign (${debtors.length})`} pad={false}>
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
      </Card>
      <StepHeading
        number={2}
        title="Send the dialling list and start calling"
        note="Writes these accounts into Jobix with this run's batch code, then triggers the flow."
      />
      <div className="mb-4">
        <LaunchPanel campaignId={campaign.id} canLaunch={canControl} />
      </div>
      <StepHeading
        number={3}
        title="Calls and results"
        note="Every call attributed to this campaign, with reach read from the transcript."
      />
      {callLog && (
        <CampaignCalls
          log={JSON.parse(JSON.stringify(callLog)) as CampaignCallsPayload}
          bucketLabels={BUCKET_LABELS}
          bucketExplanations={BUCKET_EXPLANATIONS}
        />
      )}

      <Disclosure
        className="mt-7"
        summary="Campaign detail"
        hint="performance, funnel, configuration"
      >
      <div className="grid items-start gap-4 xl:grid-cols-3">
        {hasActivity && (
          <Card
            title="Campaign performance"
            subtitle="Daily activity, last 30 days"
            className="xl:col-span-2"
          >
            <CampaignActivityChart data={series} />
          </Card>
        )}
        <Card
          title="Collection funnel"
          subtitle="Debtors at each stage of the campaign workflow"
          className={hasActivity ? undefined : "xl:col-span-2"}
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
        </Card>
        <Card title="Configuration">
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
        </Card>
      </div>
      </Disclosure>
    </div>
  );
}
