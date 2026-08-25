import { db } from "@/lib/db";

// ---------------------------------------------------------------------------
// Call service — read models for the call activity page and call detail.
// Ingestion of new calls lives in services/integrations/voice.ts.
// ---------------------------------------------------------------------------

export type CallFilters = {
  campaignId?: string;
  agentId?: string;
  outcome?: string;
  status?: string;
  debtorId?: string;
  search?: string;
};

export async function listCalls(organizationId: string, filters: CallFilters = {}, take = 200) {
  const calls = await db.call.findMany({
    where: {
      organizationId,
      ...(filters.campaignId ? { campaignId: filters.campaignId } : {}),
      ...(filters.agentId ? { agentId: filters.agentId } : {}),
      ...(filters.status ? { status: filters.status } : {}),
      ...(filters.debtorId ? { debtorId: filters.debtorId } : {}),
      ...(filters.outcome ? { analysis: { outcome: filters.outcome } } : {}),
      ...(filters.search
        ? {
            debtor: {
              OR: [
                { firstName: { contains: filters.search, mode: "insensitive" as const } },
                { lastName: { contains: filters.search, mode: "insensitive" as const } },
                { accountNumber: { contains: filters.search, mode: "insensitive" as const } },
              ],
            },
          }
        : {}),
    },
    include: {
      debtor: { select: { id: true, firstName: true, lastName: true, accountNumber: true } },
      agent: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      analysis: {
        select: { outcome: true, promisedAmount: true, sentiment: true, requiresHuman: true },
      },
    },
    orderBy: { startedAt: "desc" },
    take,
  });
  return calls;
}

export async function getCall(organizationId: string, callId: string) {
  const call = await db.call.findFirst({
    where: { id: callId, organizationId },
    include: {
      debtor: {
        include: { accounts: { select: { currentBalance: true, daysOverdue: true } } },
      },
      agent: { select: { id: true, name: true } },
      campaign: { select: { id: true, name: true } },
      analysis: true,
      promises: true,
    },
  });
  if (!call) return null;

  // Interactions with the same debtor around this call, for the detail timeline.
  const related = await db.call.findMany({
    where: { organizationId, debtorId: call.debtorId, id: { not: call.id } },
    orderBy: { startedAt: "desc" },
    take: 6,
    select: {
      id: true,
      startedAt: true,
      status: true,
      analysis: { select: { outcome: true } },
    },
  });

  return { call, related };
}
