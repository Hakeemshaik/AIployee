import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { previewReset, resetOrganizationData } from "../src/services/data-reset";

// ---------------------------------------------------------------------------
// Clear the seeded demo book from a shell.
//
// Same service the Settings screen uses, for when the UI is not reachable.
// Prints the preview and does nothing unless --confirm is passed with the
// organization's exact name.
//
//   npx tsx scripts/clear-demo-data.ts
//   npx tsx scripts/clear-demo-data.ts --confirm 'Meridian Recoveries' --rename 'My Company'
// ---------------------------------------------------------------------------

const db = new PrismaClient();

function flag(name: string): string | undefined {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
}

async function main() {
  const organization = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!organization) {
    console.log("No organization on this database. Nothing to clear.");
    return;
  }

  // The admin whose account survives: the oldest one that can actually sign in,
  // falling back to the oldest account so the database is never left userless.
  const keeper =
    (await db.user.findFirst({
      where: { organizationId: organization.id, NOT: { passwordHash: null } },
      orderBy: { createdAt: "asc" },
    })) ??
    (await db.user.findFirst({
      where: { organizationId: organization.id },
      orderBy: { createdAt: "asc" },
    }));

  if (!keeper) {
    console.log("This organization has no users. Open /setup instead.");
    return;
  }

  const preview = await previewReset(organization.id, keeper.id);
  console.log(`Organization: ${preview.organizationName}`);
  console.log(`Keeping sign-in: ${keeper.email}\n`);
  console.log("Would delete:");
  for (const row of preview.removing) {
    console.log(`  ${String(row.count).padStart(6)}  ${row.label}`);
  }
  if (preview.keeping.length > 0) {
    console.log("\nWould keep:");
    for (const row of preview.keeping) {
      console.log(`  ${String(row.count).padStart(6)}  ${row.label}`);
    }
  }

  const confirmation = flag("confirm");
  if (!confirmation) {
    console.log(
      `\nNothing has been deleted. To go ahead:\n` +
        `  npx tsx scripts/clear-demo-data.ts --confirm '${preview.organizationName}'` +
        ` [--rename 'Your Company'] [--include-ingested]`,
    );
    return;
  }

  const result = await resetOrganizationData({
    organizationId: organization.id,
    actorId: keeper.id,
    confirmation,
    newOrganizationName: flag("rename"),
    includeIngestedData: process.argv.includes("--include-ingested"),
  });
  console.log(
    `\nDeleted ${result.totalDeleted} rows, revoked ${result.keysRevoked} API key(s), ` +
      `removed ${result.usersRemoved} other user account(s).`,
  );
  console.log(`Organization is now "${result.organizationName}". Import your book at /debtors/import.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
