import Link from "next/link";
import { Bot } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { money, percent } from "@/lib/format";
import { listAgents } from "@/services/agents";
import { Badge, EmptyState, GlassCard, PageHeader } from "@/components/ui";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agents" };

export default async function AgentsPage() {
  const ctx = await getContext();
  const agents = await listAgents(ctx.organizationId);

  return (
    <div className="page-in">
      <PageHeader
        title="AI agents"
        description="Voice agents from your calling platform and their collection performance."
      />
      {agents.length === 0 ? (
        <EmptyState
          title="No agents registered"
          hint="Agents are registered against your external voice platform and appear here once linked."
        />
      ) : (
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {agents.map(({ agent, performance }) => (
            <GlassCard key={agent.id} className="transition-transform duration-150 hover:-translate-y-0.5">
              <div className="mb-3 flex items-start justify-between gap-3">
                <div className="flex items-center gap-3">
                  <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-line bg-accent-soft">
                    <Bot size={18} className="text-accent" />
                  </span>
                  <div>
                    <Link href={`/agents/${agent.id}`} className="text-[0.9375rem] font-semibold text-ink hover:text-accent">
                      {agent.name}
                    </Link>
                    <p className="text-[0.71875rem] text-ink-3">
                      {agent.campaigns.length} campaign{agent.campaigns.length === 1 ? "" : "s"}
                    </p>
                  </div>
                </div>
                <Badge value={agent.status} label={label(agent.status)} />
              </div>
              {agent.description && (
                <p className="mb-4 line-clamp-2 text-[0.78125rem] leading-relaxed text-ink-2">{agent.description}</p>
              )}
              <div className="grid grid-cols-2 gap-x-4 gap-y-3 border-t border-line-2 pt-3">
                {[
                  ["Calls today", String(performance.callsToday)],
                  ["Calls total", String(performance.callsTotal)],
                  ["Connect rate", percent(performance.connectionRate, 0)],
                  ["Promise rate", percent(performance.promiseRate, 0)],
                  ["Recovery value", money(performance.recoveryValue)],
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
