import Link from "next/link";
import { Plus } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { money, percent } from "@/lib/format";
import { listCampaigns } from "@/services/campaigns";
import { Badge, EmptyState, GlassCard, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Campaigns" };

export default async function CampaignsPage() {
  const ctx = await getContext();
  const campaigns = await listCampaigns(ctx.organizationId);

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
        <div className="grid gap-4 lg:grid-cols-2">
          {campaigns.map((c) => (
            <GlassCard key={c.id} className="transition-transform duration-150 hover:-translate-y-0.5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <Link href={`/campaigns/${c.id}`} className="text-[0.9375rem] font-semibold text-ink hover:text-accent">
                    {c.name}
                  </Link>
                  <p className="mt-0.5 truncate text-[0.75rem] text-ink-3">
                    {label(c.strategy)}
                    {c.agentName ? ` · Agent ${c.agentName}` : " · No agent assigned"}
                  </p>
                </div>
                <Badge value={c.status} label={label(c.status)} />
              </div>
              {c.description && (
                <p className="mb-4 line-clamp-2 text-[0.8125rem] leading-relaxed text-ink-2">{c.description}</p>
              )}
              <div className="grid grid-cols-3 gap-x-4 gap-y-3 border-t border-line-2 pt-3 sm:grid-cols-4">
                {[
                  ["Total debt", money(c.metrics.totalDebt)],
                  ["Debtors", String(c.metrics.totalDebtors)],
                  ["Contacted", String(c.metrics.contacted)],
                  ["Connected", String(c.metrics.connected)],
                  ["Promises", `${c.metrics.promises} · ${money(c.metrics.promiseValue)}`],
                  ["Recovered", money(c.metrics.recovered)],
                  ["Recovery rate", percent(c.metrics.recoveryRate)],
                  ["Payments", String(c.metrics.payments)],
                ].map(([k, v]) => (
                  <div key={k}>
                    <p className="text-[0.625rem] font-medium uppercase tracking-[0.07em] text-ink-3">{k}</p>
                    <p className="num mt-0.5 text-[0.8125rem] font-medium text-ink">{v}</p>
                  </div>
                ))}
              </div>
            </GlassCard>
          ))}
        </div>
      )}
    </div>
  );
}
