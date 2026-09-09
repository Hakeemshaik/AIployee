import "dotenv/config";
import { PrismaClient } from "@prisma/client";
import { hashPassword, passwordProblem } from "../src/lib/password";

// ---------------------------------------------------------------------------
// Set or reset a user's password from a shell.
//
// There is no password-reset email, so this is the recovery path: if the
// first-run claim window has closed and the password is lost, this is how you
// get back in. It uses the application's own hashing code, so the format cannot
// drift from what sign-in expects.
//
//   npx tsx scripts/set-password.ts you@company.co.za 'your new password'
//   npx tsx scripts/set-password.ts --list
// ---------------------------------------------------------------------------

const db = new PrismaClient();

async function main() {
  const [emailArg, passwordArg] = process.argv.slice(2);

  if (!emailArg || emailArg === "--list") {
    const users = await db.user.findMany({
      orderBy: { createdAt: "asc" },
      select: { name: true, email: true, role: true, passwordHash: true },
    });
    if (users.length === 0) {
      console.log("No users yet. Open /setup on the deployment first.");
      return;
    }
    console.log("Users on this deployment:\n");
    for (const user of users) {
      const state = user.passwordHash ? "can sign in" : "no password set";
      console.log(`  ${user.email}  (${user.name}, ${user.role}) — ${state}`);
    }
    console.log("\nSet one with: npx tsx scripts/set-password.ts <email> '<password>'");
    return;
  }

  if (!passwordArg) {
    console.error("Usage: npx tsx scripts/set-password.ts <email> '<password>'");
    process.exitCode = 1;
    return;
  }

  const problem = passwordProblem(passwordArg);
  if (problem) {
    console.error(`That password will not work: ${problem}`);
    process.exitCode = 1;
    return;
  }

  const email = emailArg.trim().toLowerCase();
  const existing = await db.user.findFirst({ where: { email } });
  const passwordHash = await hashPassword(passwordArg);

  if (existing) {
    await db.user.update({ where: { id: existing.id }, data: { passwordHash } });
    console.log(`Password set for ${email} (${existing.role}). You can sign in now.`);
    return;
  }

  // No such user: create an admin on the existing organization rather than
  // failing, which is the same thing the first-run claim does.
  const organization = await db.organization.findFirst({ orderBy: { createdAt: "asc" } });
  if (!organization) {
    console.error("This deployment has no organization yet. Open /setup first.");
    process.exitCode = 1;
    return;
  }
  const created = await db.user.create({
    data: {
      organizationId: organization.id,
      name: email.split("@")[0],
      email,
      role: "admin",
      passwordHash,
    },
  });
  console.log(`Created admin ${created.email} on ${organization.name}. You can sign in now.`);
}

main()
  .catch((err) => {
    console.error(err instanceof Error ? err.message : err);
    process.exitCode = 1;
  })
  .finally(() => db.$disconnect());
