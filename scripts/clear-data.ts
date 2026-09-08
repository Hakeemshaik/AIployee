/**
 * Clear an organization's data.
 *
 * Usage:
 *   npm run db:clear                  # the book and everything derived from it
 *   npm run db:clear -- --everything  # also agents, API keys and integration settings
 *   npm run db:clear -- --dry-run     # show what would go, delete nothing
 *   npm run db:clear -- --org <id>    # pick a specific organization
 *   npm run db:clear -- --yes         # skip the confirmation prompt
 *
 * Run against whichever database DATABASE_URL points at, so check it first:
 *   the script prints the host and organization before asking.
 */
import "dotenv/config";
import { createInterface } from "readline/promises";
import { PrismaClient } from "@prisma/client";

const db = new PrismaClient();

type Scope = "operational" | "everything";

function argValue(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

/** Host only — never print credentials from the connection string. */
function describeDatabase(): string {
  const url = process.env.DATABASE_URL ?? "";
  try {
    const parsed = new URL(url);
    return `${parsed.hostname}${parsed.pathname}`;
  } catch {
    return "(DATABASE_URL not set or unparseable)";
  }
}

async function main() {
  const scope: Scope = process.argv.includes("--everything") ? "everything" : "operational";
  const dryRun = process.argv.includes("--dry-run");
  const assumeYes = process.argv.includes("--yes");
  const orgId = argValue("--org");

  const org = orgId
    ? await db.organization.findUnique({ where: { id: orgId } })
    : await db.organization.findFirst({ orderBy: { createdAt: "asc" } });

  if (!org) {
    console.error(orgId ? `No organization with id ${orgId}.` : "No organization found.");
    process.exit(1);
  }

  const where = { organizationId: org.id };
  const counts: Record<string, number> = {
    debtors: await db.debtor.count({ where }),
    campaigns: await db.campaign.count({ where }),
    calls: await db.call.count({ where }),
    promises: await db.promiseToPay.count({ where }),
    payments: await db.payment.count({ where }),
    escalations: await db.escalation.count({ where }),
    reports: await db.report.count({ where }),
    insights: await db.aIInsight.count({ where }),
    batches: await db.redialBatch.count({ where }),
  };
  if (scope === "everything") {
    counts.agents = await db.aIAgent.count({ where });
    counts.apiKeys = await db.apiKey.count({ where });
  }

  const total = Object.values(counts).reduce((s, n) => s + n, 0);

  console.log(`\nDatabase    ${describeDatabase()}`);
  console.log(`Organization ${org.name} (${org.id})`);
  console.log(`Scope        ${scope}`);
  console.log("\nWill delete:");
  for (const [key, n] of Object.entries(counts)) {
    if (n > 0) console.log(`  ${String(n).padStart(7)}  ${key}`);
  }
  if (total === 0) {
    console.log("  (nothing — already empty)");
    await db.$disconnect();
    return;
  }
  console.log(
    scope === "everything"
      ? "\nKeeps: the organization and its users. Agents, API keys and integration\n       settings go too — you will need to re-run setup and re-issue the\n       voice platform key."
      : "\nKeeps: the organization, users, API keys, agents and integration settings,\n       so the voice platform webhook keeps working.",
  );

  if (dryRun) {
    console.log("\n--dry-run: nothing was deleted.");
    await db.$disconnect();
    return;
  }

  if (!assumeYes) {
    const rl = createInterface({ input: process.stdin, output: process.stdout });
    const answer = await rl.question(`\nType the organization name to confirm (${org.name}): `);
    rl.close();
    if (answer.trim() !== org.name) {
      console.log("Names did not match — nothing was deleted.");
      await db.$disconnect();
      process.exit(1);
    }
  }

  // Same order as the service: children first, in one transaction.
  await db.$transaction(async (tx) => {
    await tx.callAnalysis.deleteMany({ where });
    await tx.payment.deleteMany({ where });
    await tx.promiseToPay.deleteMany({ where });
    await tx.escalation.deleteMany({ where });
    await tx.call.deleteMany({ where });
    await tx.campaignContact.deleteMany({ where });
    await tx.redialBatch.deleteMany({ where });
    await tx.debtAccount.deleteMany({ where });
    await tx.debtor.deleteMany({ where });
    await tx.campaign.deleteMany({ where });
    await tx.providerEvent.deleteMany({ where });
    await tx.platformEvent.deleteMany({ where });
    await tx.report.deleteMany({ where });
    await tx.aIInsight.deleteMany({ where });
    if (scope === "everything") {
      await tx.aIAgent.deleteMany({ where });
      await tx.apiKey.deleteMany({ where });
      await tx.integrationSettings.deleteMany({ where });
      await tx.complianceSettings.deleteMany({ where });
    }
    await tx.auditLog.deleteMany({ where });
  });

  console.log(`\nCleared ${total} record${total === 1 ? "" : "s"} from ${org.name}.`);
  await db.$disconnect();
}

main().catch(async (err) => {
  console.error(err);
  await db.$disconnect();
  process.exit(1);
});
