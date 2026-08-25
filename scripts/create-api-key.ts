/**
 * Create an integration API key for the voice platform (e.g. Jobix).
 *
 * Usage:
 *   npm run key:create -- "Jobix production"
 *
 * Prints the plaintext key ONCE — store it in the voice platform's webhook
 * configuration. Only the SHA-256 hash is kept in the database.
 */
import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { createHash, randomBytes } from "crypto";

const db = new PrismaClient();

async function main() {
  const name = process.argv[2] ?? "Voice platform";
  const org = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!org) {
    console.error("No organization found — run `npm run db:seed` first.");
    process.exit(1);
  }

  const plaintext = `aip_live_${randomBytes(24).toString("base64url")}`;
  await db.apiKey.create({
    data: {
      organizationId: org.id,
      name,
      keyPrefix: plaintext.slice(0, 8),
      hashedKey: createHash("sha256").update(plaintext).digest("hex"),
      scopes: "voice:ingest",
    },
  });

  console.log(`API key created for ${org.name} ("${name}").`);
  console.log("\nThis is shown ONCE — copy it now:\n");
  console.log(`  ${plaintext}\n`);
  console.log("Configure the voice platform to send:");
  console.log("  POST <your-domain>/api/integrations/voice/call-completed");
  console.log(`  Authorization: Bearer ${plaintext.slice(0, 8)}…`);
}

main()
  .catch((e) => {
    console.error(e);
    process.exit(1);
  })
  .finally(() => db.$disconnect());
