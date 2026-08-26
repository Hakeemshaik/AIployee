import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { label, REPORT_TYPES } from "@/lib/domain";
import { getAIProvider } from "@/services/ai";
import type { CollectionSnapshot, ReportNarrative } from "@/services/ai";
import { buildCollectionSnapshot } from "@/services/insights";

// ---------------------------------------------------------------------------
// Report service. A report is a stored artifact: the aggregated data snapshot
// it was built from plus the AI-generated narrative, so historical reports
// stay stable as the underlying data keeps moving.
// ---------------------------------------------------------------------------

export type ReportContent = {
  narrative: ReportNarrative;
  snapshot: CollectionSnapshot;
};

const PERIOD_DAYS: Record<string, number> = {
  daily: 1,
  weekly: 7,
  campaign: 30,
  agent_performance: 30,
  ptp: 30,
  recovery: 30,
  executive_summary: 30,
};

export async function listReports(organizationId: string) {
  return db.report.findMany({
    where: { organizationId },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      type: true,
      title: true,
      periodStart: true,
      periodEnd: true,
      status: true,
      provider: true,
      generatedAt: true,
      createdAt: true,
    },
  });
}

export async function getReport(organizationId: string, reportId: string) {
  const report = await db.report.findFirst({ where: { id: reportId, organizationId } });
  if (!report) return null;
  return {
    report,
    content: report.content ? (JSON.parse(report.content) as ReportContent) : null,
  };
}

export const generateReportSchema = z.object({
  type: z.enum(REPORT_TYPES),
  campaignId: z.string().optional(),
  agentId: z.string().optional(),
});

export async function generateReport(
  organizationId: string,
  userId: string | null,
  input: z.infer<typeof generateReportSchema>,
  existingReportId?: string,
) {
  const data = generateReportSchema.parse(input);
  const periodEnd = new Date();
  const periodStart = new Date(periodEnd.getTime() - PERIOD_DAYS[data.type] * 86_400_000);

  if (data.campaignId) {
    const campaign = await db.campaign.findFirst({
      where: { id: data.campaignId, organizationId },
    });
    if (!campaign) throw new Error("Campaign not found in this organization");
  }
  if (data.agentId) {
    // Same rule as the campaign: a foreign agent id must not be persisted.
    const agent = await db.aIAgent.findFirst({
      where: { id: data.agentId, organizationId },
      select: { id: true },
    });
    if (!agent) throw new Error("Agent not found in this organization.");
  }

  const snapshot = await buildCollectionSnapshot(organizationId, {
    periodStart,
    periodEnd,
    campaignId: data.campaignId,
  });
  const provider = await getAIProvider();
  const narrative = await provider.generateReportNarrative(data.type, snapshot);
  const content: ReportContent = { narrative, snapshot };

  const title = `${label(data.type)} — ${periodEnd.toLocaleDateString("en-ZA", {
    day: "numeric",
    month: "short",
    year: "numeric",
  })}`;

  const payload = {
    organizationId,
    type: data.type,
    title,
    periodStart,
    periodEnd,
    campaignId: data.campaignId,
    agentId: data.agentId,
    status: "ready",
    content: JSON.stringify(content),
    provider: provider.name,
    generatedAt: new Date(),
  };

  const report = existingReportId
    ? await db.report.update({ where: { id: existingReportId }, data: payload })
    : await db.report.create({ data: payload });

  await audit({
    organizationId,
    actorType: userId ? "user" : "system",
    actorId: userId ?? undefined,
    action: existingReportId ? "report.regenerated" : "report.generated",
    entityType: "report",
    entityId: report.id,
    detail: { type: data.type, provider: provider.name },
  });

  return report;
}
