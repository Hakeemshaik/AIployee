import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext, hasRole } from "@/lib/auth";
import { label } from "@/lib/domain";
import { count, money } from "@/lib/format";
import { listCampaigns } from "@/services/campaigns";
import { Badge, EmptyState, PageHeader } from "@/components/ui";
import { DeleteCampaignButton } from "./DeleteCampaignButton";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await getContext();
  const campaigns = await listCampaigns(ctx.organizationId);
  const canDelete = hasRole(ctx, ["admin", "manager"]);

  return (
    <div className="page-in">
      <PageHeader
        title="Campaigns"
        description="Collection campaigns and the AI agents working them."
        actions={
          <Link href="/campaigns/new" className="btn btn-primary">
            <Plus size={14} /> New campaign
          </Link>
        }
      />
      {campaigns.length === 0 ? (
        <EmptyState
          title="No campaigns yet"
          hint="Create a campaign to start assigning debtors to an AI voice agent."
          action={<Link href="/campaigns/new" className="btn btn-primary">Create campaign</Link>}
        />
      ) : (
        // Cards that identify a campaign and nothing more. Every one of these
        // used to carry eight metrics, which put the analytics on the list —
        // eight numbers times six campaigns is a wall to read and none of it
        // answers "which campaign am I looking for". Enough to recognise it and
        // to see whether it has run; the measuring happens inside.
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {campaigns.map((c) => (
            <Link
              key={c.id}
              href={`/campaigns/${c.id}`}
              className="lift group relative block rounded-xl border border-line bg-white/[0.02] p-4 hover:bg-white/[0.04]"
            >
              <div className="mb-2.5 flex items-start justify-between gap-2">
                <div className="min-w-0">
                  {/* Wraps rather than truncates: the name is how a campaign
                      is recognised, and half of it is not enough. */}
                  <p className="text-[0.9375rem] font-semibold leading-snug text-ink group-hover:text-accent-ink">
                    {c.name}
                  </p>
                  <p className="mt-0.5 truncate text-[0.71875rem] text-ink-3">
                    {label(c.strategy)}
                    {c.agentName ? ` · ${c.agentName}` : ""}
                  </p>
                </div>
                <span className="flex shrink-0 items-center gap-1.5">
                  <Badge value={c.status} label={label(c.status)} />
                  {canDelete && (
                    <DeleteCampaignButton
                      campaignId={c.id}
                      name={c.name}
                      accounts={c.metrics.totalDebtors}
                    />
                  )}
                </span>
              </div>

              <div className="flex flex-wrap gap-x-5 gap-y-2 border-t border-line-2 pt-2.5">
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Accounts
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {count(c.metrics.totalDebtors)}
                  </span>
                </span>
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Book value
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {money(c.metrics.totalDebt)}
                  </span>
                </span>
                <span>
                  <span className="block text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">
                    Calls
                  </span>
                  <span className="num text-[0.8125rem] font-medium text-ink">
                    {c.metrics.contacted > 0 ? count(c.metrics.contacted) : "—"}
                  </span>
                </span>
              </div>

              <p className="mt-2.5 text-[0.6875rem] text-ink-3">
                {c.metrics.contacted > 0
                  ? "Open for calls, transcripts and analytics"
                  : "Not dialled yet — open to send the list"}
              </p>
            </Link>
          ))}
        </div>
      )}
    </div>
  );
}
