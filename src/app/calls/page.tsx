import Link from "next/link";
import { getContext } from "@/lib/auth";
import { CALL_OUTCOMES, CALL_STATUSES, label } from "@/lib/domain";
import { duration, formatDateTime, money } from "@/lib/format";
import { listCalls } from "@/services/calls";
import { listCampaignOptions } from "@/services/debtors";
import { Badge, EmptyState, Card, PageHeader } from "@/components/ui";
import { CollectionsTabs } from "@/components/shell/CollectionsTabs";
import { OutcomeCatchUp } from "@/components/OutcomeCatchUp";
import { Pager } from "@/components/Pager";
import { pageParam, paginate } from "@/lib/paginate";
import { ParamSelect } from "@/components/actions/ParamSelect";

export const dynamic = "force-dynamic";
export const metadata = { title: "Calls" };

export default async function CallsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getContext();
  const [calls, campaigns] = await Promise.all([
    listCalls(ctx.organizationId, {
      campaignId: params.campaign,
      outcome: params.outcome,
      status: params.status,
    }),
    listCampaignOptions(ctx.organizationId),
  ]);
  // Fifty at a time. The stats above count everything; these are the rows
  // on this page.
  const callsPage = paginate(calls, pageParam(params.page));

  return (
    <div className="page-in">
      <CollectionsTabs />
      <OutcomeCatchUp />
      <PageHeader
        title="Calls"
        description={`${callsPage.total} recent call attempt${callsPage.total === 1 ? "" : "s"} across all campaigns.`}
      />
      <div className="card-2 mb-4 flex flex-wrap items-center gap-2 p-3">
        <ParamSelect
          param="status"
          placeholder="All call statuses"
          options={CALL_STATUSES.map((s) => ({ value: s, label: label(s) }))}
        />
        <ParamSelect
          param="outcome"
          placeholder="All outcomes"
          options={CALL_OUTCOMES.map((o) => ({ value: o, label: label(o) }))}
        />
        <ParamSelect
          param="campaign"
          placeholder="All campaigns"
          options={campaigns.map((c) => ({ value: c.id, label: c.name }))}
        />
      </div>
      <Card pad={false}>
        {calls.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No calls match these filters"
              hint="Calls appear here as your voice platform posts them to the integration API."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Date / time</th>
                  <th>Debtor</th>
                  <th>Agent</th>
                  <th className="text-right">Duration</th>
                  <th>Outcome</th>
                  <th className="text-right">Promise</th>
                  <th>Sentiment</th>
                  <th>Status</th>
                  <th>Campaign</th>
                </tr>
              </thead>
              <tbody>
                {callsPage.rows.map((c) => (
                  <tr key={c.id}>
                    <td>
                      <Link href={`/calls/${c.id}`} className="font-medium text-ink hover:text-accent">
                        {formatDateTime(c.startedAt)}
                      </Link>
                    </td>
                    <td>
                      <Link href={`/debtors/${c.debtor.id}`} className="hover:text-accent">
                        {c.debtor.firstName} {c.debtor.lastName}
                      </Link>
                    </td>
                    <td className="text-ink-3">{c.agent?.name ?? "—"}</td>
                    <td className="num text-right">{duration(c.durationSeconds)}</td>
                    <td>{c.analysis ? <Badge value={c.analysis.outcome} label={label(c.analysis.outcome)} /> : "—"}</td>
                    <td className="num text-right">
                      {c.analysis?.promisedAmount != null ? money(c.analysis.promisedAmount) : "—"}
                    </td>
                    <td>{c.analysis ? <Badge value={c.analysis.sentiment} label={label(c.analysis.sentiment)} /> : "—"}</td>
                    <td><Badge value={c.status} label={label(c.status)} /></td>
                    <td className="max-w-[170px] truncate text-ink-3">{c.campaign?.name ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
      <Pager
        page={callsPage.page}
        pageCount={callsPage.pageCount}
        total={callsPage.total}
        from={callsPage.from}
        to={callsPage.to}
        noun="calls"
      />
    </div>
  );
}
