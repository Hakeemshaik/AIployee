import { PrismaClient } from "@prisma/client";

// Accept the connection-string names common hosting integrations inject
// (Neon, Vercel Postgres) so deploys work without manual env renaming.
// Only assign when a real value exists — assigning undefined to process.env
// stores the string "undefined", which Prisma then rejects as a malformed URL.
if (!process.env.DATABASE_URL) {
  const fallback =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  if (fallback) process.env.DATABASE_URL = fallback;
}

// Prisma client singleton — avoids exhausting connections during Next.js
// hot-reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
