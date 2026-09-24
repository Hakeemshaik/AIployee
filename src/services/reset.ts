import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Clearing an organization's data.
//
// Two scopes, because "clear everything" usually is not what someone means:
//
//   operational  the book and everything derived from it — debtors, campaigns,
//                calls, promises, payments, escalations, reports, insights.
//                Keeps the organization, its users, API keys, agents and
//                integration settings, so the voice platform webhook keeps
//                working and nobody has to re-run setup.
//
//   everything   the above plus agents, API keys and integration/compliance
//                settings. The organization and its users survive so the app
//                still has somewhere to log in to — everything else goes.
//
// Deletion is ordered child-first and runs in one transaction, so a failure
// part-way leaves the data as it was rather than half-deleted.
// ---------------------------------------------------------------------------

export const CLEAR_SCOPES = ["operational", "everything"] as const;
export type ClearScope = (typeof CLEAR_SCOPES)[number];

export type ClearCounts = Record<string, number>;

export type ClearResult = {
  scope: ClearScope;
  deleted: ClearCounts;
  total: number;
};

/** What is about to be deleted, without deleting it. */
export async function previewClear(
  organizationId: string,
  scope: ClearScope = "operational",
): Promise<ClearCounts> {
  const where = { organizationId };
  const [
    debtors,
    campaigns,
    calls,
    promises,
    payments,
    escalations,
    reports,
    insights,
    batches,
    events,
  ] = await Promise.all([
    db.debtor.count({ where }),
    db.campaign.count({ where }),
    db.call.count({ where }),
    db.promiseToPay.count({ where }),
    db.payment.count({ where }),
    db.escalation.count({ where }),
    db.report.count({ where }),
    db.aIInsight.count({ where }),
    db.redialBatch.count({ where }),
    db.providerEvent.count({ where }),
  ]);

  const counts: ClearCounts = {
    debtors,
    campaigns,
    calls,
    promises,
    payments,
    escalations,
    reports,
    insights,
    batches,
    providerEvents: events,
  };

  if (scope === "everything") {
    const [agents, apiKeys] = await Promise.all([
      db.aIAgent.count({ where }),
      db.apiKey.count({ where }),
    ]);
    counts.agents = agents;
    counts.apiKeys = apiKeys;
  }

  return counts;
}

export async function clearOrganizationData(
  organizationId: string,
  userId: string,
  scope: ClearScope = "operational",
): Promise<ClearResult> {
  const org = await db.organization.findUnique({ where: { id: organizationId } });
  if (!org) throw new Error("Organization not found");

  const where = { organizationId };
  const deleted: ClearCounts = {};
  const record = (key: string, result: { count: number }) => {
    if (result.count > 0) deleted[key] = result.count;
  };

  // Child-first. Most rows would cascade from Organization, but deleting them
  // explicitly keeps the organization itself intact and produces real counts.
  await db.$transaction(async (tx) => {
    record("callAnalyses", await tx.callAnalysis.deleteMany({ where }));
    record("payments", await tx.payment.deleteMany({ where }));
    record("promises", await tx.promiseToPay.deleteMany({ where }));
    record("escalations", await tx.escalation.deleteMany({ where }));
    record("calls", await tx.call.deleteMany({ where }));
    record("campaignContacts", await tx.campaignContact.deleteMany({ where }));
    record("batches", await tx.redialBatch.deleteMany({ where }));
    record("debtAccounts", await tx.debtAccount.deleteMany({ where }));
    record("debtors", await tx.debtor.deleteMany({ where }));
    record("campaigns", await tx.campaign.deleteMany({ where }));
    record("providerEvents", await tx.providerEvent.deleteMany({ where }));
    record("platformEvents", await tx.platformEvent.deleteMany({ where }));
    record("reports", await tx.report.deleteMany({ where }));
    record("insights", await tx.aIInsight.deleteMany({ where }));

    if (scope === "everything") {
      record("agents", await tx.aIAgent.deleteMany({ where }));
      record("apiKeys", await tx.apiKey.deleteMany({ where }));
      record("integrationSettings", await tx.integrationSettings.deleteMany({ where }));
      record("complianceSettings", await tx.complianceSettings.deleteMany({ where }));
    }

    // Audit last: the entries describing this deletion are written after it,
    // so the log does not record a wipe that then rolled back.
    record("auditLogs", await tx.auditLog.deleteMany({ where }));
  });

  const total = Object.values(deleted).reduce((sum, n) => sum + n, 0);

  await audit({
    organizationId,
    actorType: "user",
    actorId: userId,
    action: "organization.data_cleared",
    entityType: "organization",
    entityId: organizationId,
    detail: { scope, total, deleted },
  });

  return { scope, deleted, total };
}
