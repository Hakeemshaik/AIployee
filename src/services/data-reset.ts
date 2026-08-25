import { db } from "@/lib/db";
import { audit } from "@/lib/audit";

// ---------------------------------------------------------------------------
// Clearing the demo book.
//
// The demo seed builds a complete fictional organization — staff, debtors,
// campaigns, calls, transcripts, promises, payments. Moving to a real book
// means removing all of it without destroying the things that are genuinely
// the operator's: their own sign-in, their compliance configuration, their
// integration settings, and any data ingested from the voice provider (which
// the seed never creates, so it is real by definition).
//
// Two rules make this safe to expose in the UI:
//
//  * Nothing is deleted without an exact-match confirmation of the current
//    organization name, checked server-side.
//  * The acting admin is always preserved. Wiping the users table would lock
//    the operator out of the deployment they just cleaned.
//
// Deletion is explicit and child-first rather than relying on cascade order,
// so a schema change cannot silently start orphaning rows.
// ---------------------------------------------------------------------------

export type ResetPreview = {
  organizationName: string;
  /** What will be removed, in the order it is reported to the operator. */
  removing: { label: string; count: number }[];
  /** What survives, so the operator can see nothing important is at risk. */
  keeping: { label: string; count: number }[];
  /** Users other than the actor, who will be removed. */
  removingUsers: { name: string; email: string; role: string }[];
  /** Named credentials that will be revoked. */
  revokingKeys: { name: string; keyPrefix: string }[];
  totalRows: number;
};

export async function previewReset(
  organizationId: string,
  actorId: string,
): Promise<ResetPreview> {
  const where = { organizationId };

  const [
    organization,
    debtors,
    accounts,
    campaigns,
    campaignContacts,
    redialBatches,
    agents,
    calls,
    analyses,
    promises,
    payments,
    escalations,
    reports,
    insights,
    events,
    auditLogs,
    providerEvents,
    apiKeys,
    otherUsers,
    conversations,
    transcripts,
    nodeEvents,
    ingestionRuns,
    compliance,
    integration,
  ] = await Promise.all([
    db.organization.findUniqueOrThrow({ where: { id: organizationId }, select: { name: true } }),
    db.debtor.count({ where }),
    db.debtAccount.count({ where }),
    db.campaign.count({ where }),
    db.campaignContact.count({ where }),
    db.redialBatch.count({ where }),
    db.aIAgent.count({ where }),
    db.call.count({ where }),
    db.callAnalysis.count({ where }),
    db.promiseToPay.count({ where }),
    db.payment.count({ where }),
    db.escalation.count({ where }),
    db.report.count({ where }),
    db.aIInsight.count({ where }),
    db.platformEvent.count({ where }),
    db.auditLog.count({ where }),
    db.providerEvent.count({ where }),
    db.apiKey.findMany({ where, select: { name: true, keyPrefix: true } }),
    db.user.findMany({
      where: { organizationId, NOT: { id: actorId } },
      select: { name: true, email: true, role: true },
    }),
    db.jobixConversation.count({ where }),
    db.jobixTranscript.count({ where }),
    db.jobixNodeEvent.count({ where }),
    db.ingestionRun.count({ where }),
    db.complianceSettings.count({ where }),
    db.integrationSettings.count({ where }),
  ]);

  const removing = [
    { label: "Debtors", count: debtors },
    { label: "Debt accounts", count: accounts },
    { label: "Campaigns", count: campaigns },
    { label: "Campaign contacts", count: campaignContacts },
    { label: "Redial batches", count: redialBatches },
    { label: "Voice agents", count: agents },
    { label: "Calls", count: calls },
    { label: "Call analyses", count: analyses },
    { label: "Promises to pay", count: promises },
    { label: "Payments", count: payments },
    { label: "Escalations", count: escalations },
    { label: "Reports", count: reports },
    { label: "AI insights", count: insights },
    { label: "Platform events", count: events },
    { label: "Audit log entries", count: auditLogs },
    { label: "Provider events", count: providerEvents },
    { label: "API keys (revoked)", count: apiKeys.length },
    { label: "Other user accounts", count: otherUsers.length },
  ].filter((row) => row.count > 0);

  const keeping = [
    { label: "Your sign-in", count: 1 },
    { label: "Compliance settings", count: compliance },
    { label: "Integration settings", count: integration },
    { label: "Ingested calls (from your voice provider)", count: conversations },
    { label: "Ingested transcripts", count: transcripts },
    { label: "Ingested messaging steps", count: nodeEvents },
    { label: "Ingestion history", count: ingestionRuns },
  ].filter((row) => row.count > 0);

  return {
    organizationName: organization.name,
    removing,
    keeping,
    removingUsers: otherUsers,
    revokingKeys: apiKeys,
    totalRows: removing.reduce((sum, row) => sum + row.count, 0),
  };
}

export class ResetNotConfirmedError extends Error {
  constructor() {
    super("Type the organization name exactly to confirm.");
    this.name = "ResetNotConfirmedError";
  }
}

export type ResetOptions = {
  organizationId: string;
  actorId: string;
  /** Must equal the current organization name, character for character. */
  confirmation: string;
  /** Rename the organization at the same time — the seeded name is fictional. */
  newOrganizationName?: string;
  /** Also drop data pulled from the voice provider. Off by default. */
  includeIngestedData?: boolean;
};

export type ResetResult = {
  organizationName: string;
  deleted: Record<string, number>;
  totalDeleted: number;
  keysRevoked: number;
  usersRemoved: number;
  ingestedDataRemoved: boolean;
};

export async function resetOrganizationData(options: ResetOptions): Promise<ResetResult> {
  const { organizationId, actorId } = options;
  const organization = await db.organization.findUniqueOrThrow({
    where: { id: organizationId },
    select: { name: true },
  });

  // Checked here, not in the UI: a confirmation the client can skip is not one.
  if (options.confirmation.trim() !== organization.name) {
    throw new ResetNotConfirmedError();
  }

  const where = { organizationId };
  const deleted: Record<string, number> = {};
  const record = async (label: string, run: () => Promise<{ count: number }>) => {
    const { count } = await run();
    if (count > 0) deleted[label] = count;
  };

  // Child rows first. Explicit order, so this does not depend on cascade rules
  // that a future schema change might alter.
  await record("callAnalyses", () => db.callAnalysis.deleteMany({ where }));
  await record("payments", () => db.payment.deleteMany({ where }));
  await record("promises", () => db.promiseToPay.deleteMany({ where }));
  await record("escalations", () => db.escalation.deleteMany({ where }));
  await record("calls", () => db.call.deleteMany({ where }));
  await record("campaignContacts", () => db.campaignContact.deleteMany({ where }));
  await record("redialBatches", () => db.redialBatch.deleteMany({ where }));
  await record("debtAccounts", () => db.debtAccount.deleteMany({ where }));
  await record("debtors", () => db.debtor.deleteMany({ where }));
  await record("campaigns", () => db.campaign.deleteMany({ where }));
  await record("agents", () => db.aIAgent.deleteMany({ where }));
  await record("reports", () => db.report.deleteMany({ where }));
  await record("insights", () => db.aIInsight.deleteMany({ where }));
  await record("platformEvents", () => db.platformEvent.deleteMany({ where }));
  await record("providerEvents", () => db.providerEvent.deleteMany({ where }));

  if (options.includeIngestedData) {
    await record("jobixTranscripts", () => db.jobixTranscript.deleteMany({ where }));
    await record("jobixConversations", () => db.jobixConversation.deleteMany({ where }));
    await record("jobixNodeEvents", () => db.jobixNodeEvent.deleteMany({ where }));
    await record("ingestionRuns", () => db.ingestionRun.deleteMany({ where }));
  }

  // Every seeded key is revoked, including the one whose plaintext value is
  // printed in this repository's README and therefore public.
  const keys = await db.apiKey.deleteMany({ where });
  if (keys.count > 0) deleted.apiKeys = keys.count;

  // The acting admin is never removed — that would lock the operator out.
  const users = await db.user.deleteMany({ where: { organizationId, NOT: { id: actorId } } });
  if (users.count > 0) deleted.users = users.count;

  // Audit history last: everything above it was demo activity. The reset itself
  // is then the first entry of the real book.
  await record("auditLogs", () => db.auditLog.deleteMany({ where }));

  const finalName = options.newOrganizationName?.trim();
  if (finalName && finalName !== organization.name) {
    await db.organization.update({
      where: { id: organizationId },
      data: { name: finalName, slug: slugify(finalName) },
    });
  }

  // A campaign needs an agent to point at, so leave one placeholder behind
  // rather than a screen that cannot be used.
  await db.aIAgent.create({
    data: {
      organizationId,
      name: "Voice Agent",
      description: "Set externalId to your voice platform's agent id.",
      status: "active",
    },
  });

  await audit({
    organizationId,
    actorType: "user",
    actorId,
    action: "organization.data_reset",
    entityType: "organization",
    entityId: organizationId,
    detail: {
      deleted,
      renamedTo: finalName && finalName !== organization.name ? finalName : undefined,
      includedIngestedData: !!options.includeIngestedData,
    },
  });

  return {
    organizationName: finalName || organization.name,
    deleted,
    totalDeleted: Object.values(deleted).reduce((sum, n) => sum + n, 0),
    keysRevoked: keys.count,
    usersRemoved: users.count,
    ingestedDataRemoved: !!options.includeIngestedData,
  };
}

export function slugify(name: string): string {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-|-$/g, "")
      .slice(0, 60) || "organization"
  );
}
