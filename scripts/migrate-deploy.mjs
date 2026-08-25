// Run `prisma migrate deploy` with database URLs resolved from the variable
// names different hosts/integrations inject (Neon, Vercel Postgres, plain PG),
// so the Vercel build works without renaming environment variables by hand.
import { spawnSync } from "node:child_process";

const url =
  process.env.DATABASE_URL ??
  process.env.POSTGRES_PRISMA_URL ??
  process.env.POSTGRES_URL ??
  process.env.NEON_DATABASE_URL;

const directUrl =
  process.env.DIRECT_DATABASE_URL ??
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  url;

if (!url) {
  console.error(
    [
      "",
      "✖ No database connection string found.",
      "",
      "The build needs a PostgreSQL database. On Vercel:",
      "  1. Project → Storage → Create Database → Neon (Postgres) → Connect.",
      "     (This injects DATABASE_URL and DATABASE_URL_UNPOOLED automatically.)",
      "  2. Redeploy.",
      "",
      "Or set DATABASE_URL (pooled) and DIRECT_DATABASE_URL (direct) manually in",
      "Project → Settings → Environment Variables.",
      "",
    ].join("\n"),
  );
  process.exit(1);
}

const result = spawnSync("npx", ["prisma", "migrate", "deploy"], {
  stdio: "inherit",
  env: { ...process.env, DATABASE_URL: url, DIRECT_DATABASE_URL: directUrl },
});
process.exit(result.status ?? 1);
