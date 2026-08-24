import { z } from "zod";
import { db } from "@/lib/db";
import { audit } from "@/lib/audit";
import { emitEvent } from "@/lib/events";
import { CAMPAIGN_STATUSES, CAMPAIGN_STRATEGIES } from "@/lib/domain";
import { startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// Campaign service — creation, lifecycle and computed performance metrics.
// ---------------------------------------------------------------------------

export type CampaignMetrics = {
  totalDebt: number;
  totalDebtors: number;
  contacted: number;
  connected: number;
  promises: number;
  promiseValue: number;
  payments: number;
  recovered: number;
  recoveryRate: number;
};

function computeMetrics(campaign: {
  debtors: { accounts: { currentBalance: number }[] }[];
  calls: { status: string; debtorId: string }[];
  promises: { amount: number }[];
  payments: { amount: number }[];
}): CampaignMetrics {
  const totalDebt = campaign.debtors.reduce(
    (s, d) => s + d.accounts.reduce((s2, a) => s2 + a.currentBalance, 0),
    0,
  );
  const recovered = campaign.payments.reduce((s, p) => s + p.amount, 0);
  return {
    totalDebt,
    totalDebtors: campaign.debtors.length,
    contacted: new Set(campaign.calls.map((c) => c.debtorId)).size,
    connected: new Set(campaign.calls.filter((c) => c.status === "completed").map((c) => c.debtorId)).size,
    promises: campaign.promises.length,
    promiseValue: campaign.promises.reduce((s, p) => s + p.amount, 0),
    payments: campaign.payments.length,
    recovered,
    recoveryRate: totalDebt + recovered > 0 ? recovered / (totalDebt + recovered) : 0,
  };
}

const CAMPAIGN_INCLUDE = {
  agent: { select: { id: true, name: true } },
  debtors: { select: { id: true, accounts: { select: { currentBalance: true } } } },
  calls: { select: { status: true, debtorId: true } },
  promises: { select: { amount: true } },
  payments: { where: { status: "completed" }, select: { amount: true } },
} as const;

export async function listCampaigns(organizationId: string) {
  const campaigns = await db.campaign.findMany({
    where: { organizationId },
    include: CAMPAIGN_INCLUDE,
    orderBy: [{ status: "asc" }, { createdAt: "desc" }],
  });
  return campaigns.map((c) => ({
    id: c.id,
    name: c.name,
    description: c.description,
    status: c.status,
    strategy: c.strategy,
    agentName: c.agent?.name ?? null,
    startDate: c.startDate,
    endDate: c.endDate,
    metrics: computeMetrics(c),
  }));
}

export async function getCampaign(organizationId: string, campaignId: string) {
  const campaign = await db.campaign.findFirst({
    where: { id: campaignId, organizationId },
    include: { ...CAMPAIGN_INCLUDE, agent: true },
  });
  if (!campaign) return null;

  // Daily performance series over the last 30 days: attempts, connects,
  // promises created, and rands recovered.
  const since = new Date(Date.now() - 30 * 86_400_000);
  const [calls, promises, payments] = await Promise.all([
    db.call.findMany({
      where: { organizationId, campaignId, startedAt: { gte: since } },
      select: { startedAt: true, status: true },
    }),
    db.promiseToPay.findMany({
      where: { organizationId, campaignId, createdAt: { gte: since } },
      select: { createdAt: true, amount: true },
    }),
    db.payment.findMany({
      where: { organizationId, campaignId, status: "completed", paidAt: { gte: since } },
      select: { paidAt: true, amount: true },
    }),
  ]);

  const series: { date: string; attempts: number; connected: number; promises: number; recovered: number }[] = [];
  for (let i = 29; i >= 0; i--) {
    const day = startOfDay(new Date(Date.now() - i * 86_400_000));
    const next = new Date(day.getTime() + 86_400_000);
    const inDay = (d: Date) => d >= day && d < next;
    series.push({
      date: day.toISOString().slice(0, 10),
      attempts: calls.filter((c) => inDay(c.startedAt)).length,
      connected: calls.filter((c) => c.status === "completed" && inDay(c.startedAt)).length,
      promises: promises.filter((p) => inDay(p.createdAt)).length,
      recovered: Math.round(payments.filter((p) => inDay(p.paidAt)).reduce((s, p) => s + p.amount, 0)),
    });
  }

  return { campaign, metrics: computeMetrics(campaign), series };
}

export const createCampaignSchema = z.object({
  name: z.string().min(3).max(120),
  description: z.string().max(1000).optional(),
  segment: z.string().max(500).optional(),
  agentId: z.string().optional(),
  startDate: z.coerce.date().optional(),
  endDate: z.coerce.date().optional(),
  callingHoursStart: z.string().regex(/^\d{2}:\d{2}$/).default("09:00"),
  callingHoursEnd: z.string().regex(/^\d{2}:\d{2}$/).default("18:00"),
  maxAttempts: z.coerce.number().int().min(1).max(30).default(6),
  retryIntervalHours: z.coerce.number().int().min(1).max(720).default(48),
  strategy: z.enum(CAMPAIGN_STRATEGIES).default("standard"),
  status: z.enum(CAMPAIGN_STATUSES).default("draft"),
});

export async function createCampaign(
  organizationId: string,
  userId: string,
  input: z.infer<typeof createCampaignSchema>,
) {
  const data = createCampaignSchema.parse(input);
  if (data.agentId) {
    // Tenant isolation: the agent must belong to the same organization.
    const agent = await db.aIAgent.findFirst({ where: { id: data.agentId, organizationId } });
    if (!agent) throw new Error("Agent not found in this organization");
  }
  const campaign = await db.campaign.create({ data: { ...data, organizationId } });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.created",
    entityType: "campaign",
    entityId: campaign.id,
    detail: { name: campaign.name, status: campaign.status },
  });
  if (campaign.status === "active") {
    await emitEvent({
      type: "campaign.started",
      organizationId,
      entityType: "campaign",
      entityId: campaign.id,
      payload: { name: campaign.name },
    });
  }
  return campaign;
}

export async function updateCampaignStatus(
  organizationId: string,
  userId: string,
  campaignId: string,
  status: (typeof CAMPAIGN_STATUSES)[number],
) {
  z.enum(CAMPAIGN_STATUSES).parse(status);
  const existing = await db.campaign.findFirst({ where: { id: campaignId, organizationId } });
  if (!existing) throw new Error("Campaign not found");
  const campaign = await db.campaign.update({ where: { id: campaignId }, data: { status } });
  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "campaign.status_changed",
    entityType: "campaign",
    entityId: campaignId,
    detail: { from: existing.status, to: status },
  });
  if (status === "active" && existing.status !== "active") {
    await emitEvent({ type: "campaign.started", organizationId, entityType: "campaign", entityId: campaignId, payload: { name: campaign.name } });
  }
  if (status === "completed") {
    await emitEvent({ type: "campaign.completed", organizationId, entityType: "campaign", entityId: campaignId, payload: { name: campaign.name } });
  }
  return campaign;
}
