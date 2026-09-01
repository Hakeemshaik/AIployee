import Link from "next/link";
import { notFound } from "next/navigation";
import { Lock } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDateTime, money, percent } from "@/lib/format";
import { getAgent } from "@/services/agents";
import { BackLink, Badge, Card, Meta, PageHeader, StatCard } from "@/components/ui";
import { HBarChart } from "@/components/charts";

export const dynamic = "force-dynamic";
export const metadata = { title: "Agent" };

export default async function AgentDetailPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  const ctx = await getContext();
  const result = await getAgent(ctx.organizationId, id);
  if (!result) notFound();
  const { agent, performance, outcomes, recentCalls } = result;
  const voice = agent.voiceConfig
    ? (JSON.parse(agent.voiceConfig) as { voice?: string; language?: string; speakingRate?: number })
    : null;

  return (
    <div className="page-in">
      <BackLink href="/agents" label="All agents" />
      <PageHeader
        title={agent.name}
        description={agent.description ?? undefined}
        actions={<Badge value={agent.status} label={label(agent.status)} />}
      />

      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
        <StatCard label="Calls today" value={String(performance.callsToday)} />
        <StatCard label="Calls total" value={String(performance.callsTotal)} />
        <StatCard label="Connect rate" value={percent(performance.connectionRate, 0)} />
        <StatCard label="Promise rate" value={percent(performance.promiseRate, 0)} sub="promises per connected call" />
        <StatCard label="Recovery value" value={money(performance.recoveryValue)} tone="good" sub="from this agent's promises" />
      </div>

      <div className="grid gap-4 xl:grid-cols-3">
        <div className="space-y-4 xl:col-span-2">
          <Card title="Call outcomes" subtitle="All analysed calls handled by this agent">
            {Object.keys(outcomes).length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">No analysed calls yet.</p>
            ) : (
              <HBarChart
                data={Object.entries(outcomes)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 8)
                  .map(([o, n]) => ({ label: label(o), value: n }))}
              />
            )}
          </Card>
          <Card title="Recent calls" pad={false}>
            {recentCalls.length === 0 ? (
              <p className="p-6 text-center text-[0.8125rem] text-ink-3">No calls yet.</p>
            ) : (
              <div className="scroll-x">
                <table className="data-table">
                  <thead>
                    <tr>
                      <th>Date / time</th>
                      <th>Debtor</th>
                      <th>Outcome</th>
                      <th>Sentiment</th>
                    </tr>
                  </thead>
                  <tbody>
                    {recentCalls.map((c) => (
                      <tr key={c.id}>
                        <td>
                          <Link href={`/calls/${c.id}`} className="font-medium text-ink hover:text-accent">
                            {formatDateTime(c.startedAt)}
                          </Link>
                        </td>
                        <td>{c.debtor.firstName} {c.debtor.lastName}</td>
                        <td>
                          <Badge value={c.analysis?.outcome ?? c.status} label={label(c.analysis?.outcome ?? c.status)} />
                        </td>
                        <td>{c.analysis ? <Badge value={c.analysis.sentiment} label={label(c.analysis.sentiment)} /> : "—"}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}
          </Card>
        </div>

        <div className="space-y-4">
          <Card title="Voice configuration" subtitle="Managed on the voice platform">
            <dl>
              <Meta label="External agent ID"><span className="num text-[0.71875rem]">{agent.externalId ?? "—"}</span></Meta>
              <Meta label="Voice">{voice?.voice ?? "—"}</Meta>
              <Meta label="Language">{voice?.language ?? "—"}</Meta>
              <Meta label="Speaking rate">{voice?.speakingRate ?? "—"}</Meta>
            </dl>
            <p className="mt-3 text-[0.6875rem] leading-relaxed text-ink-3">
              Telephony, voices and dialling behaviour are configured on the external voice platform;
              this platform only references them.
            </p>
          </Card>
          <Card title="Prompt configuration">
            <div className="flex items-start gap-3 rounded-lg border border-line bg-white/[0.03] p-3">
              <Lock size={15} className="mt-0.5 shrink-0 text-ink-3" />
              <div>
                <p className="text-[0.78125rem] font-medium text-ink">Prompt stored on the voice platform</p>
                <p className="num mt-0.5 break-all text-[0.6875rem] text-ink-3">{agent.promptRef ?? "Not linked"}</p>
                <p className="mt-2 text-[0.6875rem] leading-relaxed text-ink-3">
                  System prompts are never stored or displayed in this dashboard — only a reference to
                  the prompt version on the voice platform.
                </p>
              </div>
            </div>
          </Card>
          <Card title="Campaign assignments">
            {agent.campaigns.length === 0 ? (
              <p className="text-[0.8125rem] text-ink-3">Not assigned to any campaign.</p>
            ) : (
              <ul className="space-y-2.5">
                {agent.campaigns.map((c) => (
                  <li key={c.id} className="flex items-center justify-between gap-3">
                    <Link href={`/campaigns/${c.id}`} className="text-[0.8125rem] text-ink-2 hover:text-accent">
                      {c.name}
                    </Link>
                    <Badge value={c.status} label={label(c.status)} />
                  </li>
                ))}
              </ul>
            )}
          </Card>
        </div>
      </div>
    </div>
  );
}
