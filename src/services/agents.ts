import { db } from "@/lib/db";
import { startOfDay } from "@/lib/format";

// ---------------------------------------------------------------------------
// AI agent service — performance read models for the voice agents. Voice and
// prompt configuration are placeholders referencing the external voice
// platform; prompts and keys are never stored or exposed here.
// ---------------------------------------------------------------------------

export type AgentPerformance = {
  callsToday: number;
  callsTotal: number;
  connectionRate: number;
  promiseRate: number; // promises per connected call
  recoveryValue: number;
};

async function computePerformance(organizationId: string, agentId: string): Promise<AgentPerformance> {
  const today = startOfDay(new Date());
  const calls = await db.call.findMany({
    where: { organizationId, agentId },
    select: { status: true, startedAt: true, debtorId: true },
  });
  const connected = calls.filter((c) => c.status === "completed").length;
  const promises = await db.promiseToPay.count({
    where: { organizationId, call: { agentId } },
  });
  const payments = await db.payment.aggregate({
    where: {
      organizationId,
      status: "completed",
      promise: { call: { agentId } },
    },
    _sum: { amount: true },
  });
  return {
    callsToday: calls.filter((c) => c.startedAt >= today).length,
    callsTotal: calls.length,
    connectionRate: calls.length ? connected / calls.length : 0,
    promiseRate: connected ? promises / connected : 0,
    recoveryValue: payments._sum.amount ?? 0,
  };
}

export async function listAgents(organizationId: string) {
  const agents = await db.aIAgent.findMany({
    where: { organizationId },
    include: { campaigns: { select: { id: true, name: true, status: true } } },
    orderBy: { name: "asc" },
  });
  return Promise.all(
    agents.map(async (agent) => ({
      agent,
      performance: await computePerformance(organizationId, agent.id),
    })),
  );
}

export async function getAgent(organizationId: string, agentId: string) {
  const agent = await db.aIAgent.findFirst({
    where: { id: agentId, organizationId },
    include: { campaigns: true },
  });
  if (!agent) return null;

  const performance = await computePerformance(organizationId, agentId);
  const analyses = await db.callAnalysis.findMany({
    where: { organizationId, call: { agentId } },
    select: { outcome: true },
  });
  const outcomes: Record<string, number> = {};
  for (const a of analyses) outcomes[a.outcome] = (outcomes[a.outcome] ?? 0) + 1;

  const recentCalls = await db.call.findMany({
    where: { organizationId, agentId },
    include: {
      debtor: { select: { firstName: true, lastName: true } },
      analysis: { select: { outcome: true, sentiment: true } },
    },
    orderBy: { startedAt: "desc" },
    take: 8,
  });

  return { agent, performance, outcomes, recentCalls };
}
