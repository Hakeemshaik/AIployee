import Link from "next/link";
import { getContext } from "@/lib/auth";
import { ESCALATION_PRIORITIES, ESCALATION_REASONS, ESCALATION_STATUSES, label } from "@/lib/domain";
import { formatDate } from "@/lib/format";
import { getEscalationStats, listEscalations, listUsers } from "@/services/escalations";
import { Badge, EmptyState, Card, PageHeader, StatCard } from "@/components/ui";
import { ParamSelect } from "@/components/actions/ParamSelect";
import { EscalationControls } from "./Controls";

export const dynamic = "force-dynamic";
export const metadata = { title: "Escalations" };

export default async function EscalationsPage({
  searchParams,
}: {
  searchParams: Promise<Record<string, string | undefined>>;
}) {
  const params = await searchParams;
  const ctx = await getContext();
  const [stats, escalations, users] = await Promise.all([
    getEscalationStats(ctx.organizationId),
    listEscalations(ctx.organizationId, {
      status: params.status,
      priority: params.priority,
      reason: params.reason,
    }),
    listUsers(ctx.organizationId),
  ]);

  return (
    <div className="page-in">
      <PageHeader
        title="Escalations"
        description="Cases the AI has handed off for human judgement — disputes, hardship, vulnerability and authority limits."
      />
      <div className="mb-5 grid grid-cols-2 gap-3 md:grid-cols-5">
        <StatCard label="Open" value={String(stats.open)} tone={stats.open > 0 ? "critical" : undefined} />
        <StatCard label="In review" value={String(stats.inReview)} />
        <StatCard label="Assigned" value={String(stats.assigned)} />
        <StatCard label="Resolved" value={String(stats.resolved)} tone="good" />
        <StatCard label="Urgent unresolved" value={String(stats.urgent)} tone={stats.urgent > 0 ? "critical" : undefined} />
      </div>

      <div className="card-2 mb-4 flex flex-wrap items-center gap-2 p-3">
        <ParamSelect param="status" placeholder="All statuses" options={ESCALATION_STATUSES.map((s) => ({ value: s, label: label(s) }))} />
        <ParamSelect param="priority" placeholder="All priorities" options={ESCALATION_PRIORITIES.map((p) => ({ value: p, label: label(p) }))} />
        <ParamSelect param="reason" placeholder="All reasons" options={ESCALATION_REASONS.map((r) => ({ value: r, label: label(r) }))} />
      </div>

      <Card pad={false}>
        {escalations.length === 0 ? (
          <div className="p-5">
            <EmptyState
              title="No escalations match"
              hint="The AI raises escalations automatically when a call needs human handling."
            />
          </div>
        ) : (
          <div className="scroll-x">
            <table className="data-table">
              <thead>
                <tr>
                  <th>Priority</th>
                  <th>Debtor</th>
                  <th>Reason</th>
                  <th>Raised</th>
                  <th>Campaign</th>
                  <th>Status</th>
                  <th className="text-right">Assign / update</th>
                </tr>
              </thead>
              <tbody>
                {escalations.map((e) => (
                  <tr key={e.id}>
                    <td><Badge value={e.priority} label={label(e.priority)} /></td>
                    <td>
                      <Link href={`/debtors/${e.debtor.id}`} className="font-medium text-ink hover:text-accent">
                        {e.debtor.firstName} {e.debtor.lastName}
                      </Link>
                      {e.call && (
                        <Link href={`/calls/${e.call.id}`} className="ml-2 text-[0.6875rem] text-accent hover:underline">
                          view call
                        </Link>
                      )}
                      {e.notes && (
                        <p className="mt-0.5 max-w-md truncate text-[0.71875rem] text-ink-3" title={e.notes}>
                          {e.notes}
                        </p>
                      )}
                    </td>
                    <td><Badge value={e.reason} label={label(e.reason)} /></td>
                    <td className="text-ink-3">{formatDate(e.createdAt)}</td>
                    <td className="max-w-[160px] truncate text-ink-3">{e.campaign?.name ?? "—"}</td>
                    <td><Badge value={e.status} label={label(e.status)} /></td>
                    <td>
                      <EscalationControls
                        escalationId={e.id}
                        status={e.status}
                        assignedToUserId={e.assignedTo?.id ?? null}
                        users={users}
                      />
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
      </Card>
    </div>
  );
}
