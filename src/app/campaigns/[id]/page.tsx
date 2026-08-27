import Link from "next/link";
import { notFound } from "next/navigation";
import { getContext, hasRole } from "@/lib/auth";
import { label } from "@/lib/domain";
import { count, duration, formatDate, formatDateTime, money, percent } from "@/lib/format";
import { getCampaign } from "@/services/campaigns";
import { listDebtors } from "@/services/debtors";
import { BackLink, Badge, GlassCard, Meta, PageHeader, StatCard } from "@/components/ui";
import { CampaignActivityChart, HBarChart, PaymentsBarChart } from "@/components/charts";
import { StatusControls } from "./StatusControls";
import { LiveCampaign } from "./LiveCampaign";
import { LaunchPanel } from "./LaunchPanel";
import { getCampaignLiveState } from "@/services/campaign-live";
import { campaignCallLog, MATCH_NOTES } from "@/services/campaign-calls";
import { BookImporter } from "@/components/BookImporter";

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

  return (
    <div className="page-in">
      <BackLink href="/campaigns" label="All campaigns" />
      <PageHeader
        title={campaign.name}
        description={campaign.description ?? undefined}
        actions={
          <div className="flex flex-wrap items-center justify-end gap-2">
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

      <div className="mb-4">
        <LaunchPanel campaignId={campaign.id} canLaunch={canControl} />
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

      {callLog && (
        <GlassCard
          title={`Calls in this campaign (${count(callLog.totalCalls)})`}
          subtitle={
            callLog.batchCode
              ? `Batch ${callLog.batchCode}${callLog.batchSentAt ? ` · sent ${formatDateTime(callLog.batchSentAt)}` : ""}`
              : "No dialling batch has been sent for this campaign yet"
          }
          className="mb-4"
          pad={false}
        >
          <div className="border-b border-line-2 px-5 pb-4">
            <div className="flex flex-wrap gap-1.5">
              <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Accounts in campaign <span className="num">{count(callLog.accountsInCampaign)}</span>
              </span>
              <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                Dialled <span className="num">{count(callLog.accountsDialled)}</span>
              </span>
              <span className="rounded-full border border-[rgba(25,158,112,0.35)] bg-[rgba(25,158,112,0.1)] px-2.5 py-1 text-[0.6875rem] text-[#3ecf9a]">
                Reached <span className="num">{count(callLog.reachedCalls)}</span> of{" "}
                <span className="num">{count(callLog.totalCalls)}</span> calls
              </span>
              {callLog.batchCode && (
                <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-2">
                  Carrying batch on the platform{" "}
                  <span className="num">{count(callLog.accountsCarryingBatch)}</span>
                </span>
              )}
              {callLog.callsBeforeBatch > 0 && (
                <span className="rounded-full border border-line bg-white/[0.03] px-2.5 py-1 text-[0.6875rem] text-ink-3">
                  Excluded, predate the batch <span className="num">{count(callLog.callsBeforeBatch)}</span>
                </span>
              )}
            </div>
            <p className="mt-2.5 text-[0.6875rem] leading-relaxed text-ink-3">
              A call is tied to this campaign through the account it belongs to — by the voice platform&apos;s
              own customer identifier where the call record carries one, otherwise by phone number. Reach is
              read from the transcript, never from the platform&apos;s voicemail flag.
              {callLog.batchSentAt
                ? " Calls before this batch was sent belong to an earlier run and are excluded."
                : " Without a sent batch every call to these accounts is listed, whenever it happened."}
            </p>
          </div>
          {callLog.calls.length === 0 ? (
            <p className="p-8 text-center text-[0.8125rem] text-ink-3">
              No calls recorded for these accounts yet. Run ingestion on the Call analytics page after the
              batch has dialled.
            </p>
          ) : (
            <div className="scroll-x">
              <table className="data-table">
                <thead>
                  <tr>
                    <th>When</th>
                    <th>Account</th>
                    <th className="text-right">Attempt</th>
                    <th className="text-right">Talk time</th>
                    <th>Agent</th>
                    <th>Outcome</th>
                    <th>Basis</th>
                  </tr>
                </thead>
                <tbody>
                  {callLog.calls.map((call) => (
                    <tr key={call.conversationUuid}>
                      <td className="num text-ink-3">{formatDateTime(call.startedAt)}</td>
                      <td>
                        <Link
                          href={`/debtors/${call.debtorId}`}
                          className="font-medium text-ink hover:text-accent"
                        >
                          {call.name}
                        </Link>
                        <span className="num ml-2 text-[0.6875rem] text-ink-3">{call.accountNumber}</span>
                      </td>
                      <td className="num text-right">{call.attempt}</td>
                      <td className="num text-right">{duration(call.durationSeconds)}</td>
                      <td className="text-ink-3">{call.agentName ?? "—"}</td>
                      <td>
                        <span
                          className={call.reached ? "text-[#3ecf9a]" : "text-ink-3"}
                          title={call.reason}
                        >
                          {call.reached ? "Reached" : "Not reached"}
                        </span>
                      </td>
                      <td className="text-[0.6875rem] text-ink-3" title={MATCH_NOTES[call.matchedBy]}>
                        {call.matchedBy === "contact_uuid" ? "Identifier" : "Phone"}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
          {callLog.truncated > 0 && (
            <p className="border-t border-line-2 px-5 py-3 text-[0.6875rem] text-ink-3">
              Showing the {count(callLog.calls.length)} most recent of{" "}
              <span className="num">{count(callLog.totalCalls)}</span> calls.
            </p>
          )}
        </GlassCard>
      )}

      {canControl && (
        <GlassCard
          title="Add accounts to this campaign"
          subtitle="Upload the client's file in any format — reviewed in full before anything is written"
          className="mb-4"
        >
          <BookImporter fixedCampaign={{ id: campaign.id, name: campaign.name }} />
        </GlassCard>
      )}

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
