import { Sparkles } from "lucide-react";
import { getContext } from "@/lib/auth";
import { label } from "@/lib/domain";
import { formatDate, formatDateTime } from "@/lib/format";
import { getLatestInsight } from "@/services/insights";
import { Badge, EmptyState, Card, PageHeader } from "@/components/ui";
import { RefreshInsightsButton } from "@/components/actions/RefreshInsights";
import type { InsightFinding, RecommendedAction } from "@/services/ai";

export const dynamic = "force-dynamic";
export const metadata = { title: "AI insights" };

function FindingList({ items }: { items: InsightFinding[] }) {
  if (!items?.length) return <p className="text-[0.8125rem] text-ink-3">Nothing notable in this period.</p>;
  return (
    <ul className="space-y-3">
      {items.map((f, i) => (
        <li key={i} className="text-[0.8125rem] leading-relaxed text-ink-2">
          <span className="font-medium text-ink">{f.title}.</span> {f.detail}
        </li>
      ))}
    </ul>
  );
}

export default async function InsightsPage() {
  const ctx = await getContext();
  const insight = await getLatestInsight(ctx.organizationId, "insights");

  return (
    <div className="page-in">
      <PageHeader
        title="AI insights"
        description="Structured analysis of outcomes, behaviour, risk and campaign performance across the last 30 days."
        actions={<RefreshInsightsButton scope="insights" />}
      />

      {!insight ? (
        <EmptyState
          title="No analysis yet"
          hint="Generate insights once there is collection activity to analyse."
        />
      ) : (
        <>
          <Card
            className="mb-4"
            title="Collection summary"
            subtitle={`Generated ${formatDateTime(insight.generatedAt)} · ${insight.provider === "claude" ? "Claude" : "built-in engine"}`}
          >
            <p className="mb-3 flex items-start gap-2 text-[0.9375rem] leading-relaxed text-ink">
              <Sparkles size={16} className="mt-1 shrink-0 text-accent" />
              {insight.content.headline}
            </p>
            <p className="max-w-4xl text-[0.8125rem] leading-relaxed text-ink-2">
              {insight.content.collectionSummary}
            </p>
          </Card>

          <div className="mb-4 grid gap-4 lg:grid-cols-2">
            <Card title="Key findings"><FindingList items={insight.content.keyFindings} /></Card>
            <Card title="Risk trends"><FindingList items={insight.content.riskTrends} /></Card>
            <Card title="Debtor behaviour"><FindingList items={insight.content.debtorBehaviour} /></Card>
            <Card title="Campaign performance"><FindingList items={insight.content.campaignPerformance} /></Card>
          </div>

          <div className="grid gap-4 lg:grid-cols-2">
            <Card title="Recommended actions">
              <ul className="space-y-3">
                {insight.content.recommendedActions.map((a: RecommendedAction, i: number) => (
                  <li key={i} className="flex items-start gap-3">
                    <Badge value={a.priority} label={label(a.priority)} />
                    <p className="text-[0.8125rem] leading-relaxed text-ink-2">
                      <span className="font-medium text-ink">{a.title}.</span> {a.detail}
                    </p>
                  </li>
                ))}
              </ul>
            </Card>
            <Card title="Anomalies"><FindingList items={insight.content.anomalies} /></Card>
          </div>

          <p className="mt-4 text-[0.71875rem] text-ink-3">
            Analysis window: {formatDate(insight.content ? insight.generatedAt : null)} — based on call
            outcomes, promise fulfilment, payments, contact rates, aging and sentiment. No debtor
            personal information is sent to the AI provider.
          </p>
        </>
      )}
    </div>
  );
}
