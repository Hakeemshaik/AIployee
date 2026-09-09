import { Prisma, PrismaClient } from "@prisma/client";

// Accept the connection-string names common hosting integrations inject
// (Neon, Vercel Postgres) so deploys work without manual env renaming.
// Only assign when a real value exists — assigning undefined to process.env
// stores the string "undefined", which Prisma then rejects as a malformed URL.
if (!process.env.DATABASE_URL) {
  const fallback =
    process.env.POSTGRES_PRISMA_URL ?? process.env.POSTGRES_URL ?? process.env.NEON_DATABASE_URL;
  if (fallback) process.env.DATABASE_URL = fallback;
}

// ---------------------------------------------------------------------------
// Retry dropped connections, reads only.
//
// Serverless Postgres (Neon) suspends idle databases and closes their
// connections; the next invocation reuses a dead one and the first query
// fails with P1017 ("Server has closed the connection") or P1001 (can't
// reach), then everything works. Seen in production as an error page that a
// reload fixed. One retry with a short pause absorbs the wake-up.
//
// Writes are deliberately NOT retried: "connection closed" cannot be told
// apart from "executed, then the connection dropped", and re-running a create
// could double-write. A failed write surfaces to the caller as before.
// ---------------------------------------------------------------------------

const RETRYABLE_CODES = new Set(["P1017", "P1001"]);
const READ_OPERATIONS = new Set([
  "findUnique",
  "findUniqueOrThrow",
  "findFirst",
  "findFirstOrThrow",
  "findMany",
  "count",
  "aggregate",
  "groupBy",
]);

function isDroppedConnection(error: unknown): boolean {
  return (
    (error instanceof Prisma.PrismaClientKnownRequestError && RETRYABLE_CODES.has(error.code)) ||
    error instanceof Prisma.PrismaClientInitializationError
  );
}

function withConnectionRetry(client: PrismaClient) {
  return client.$extends({
    query: {
      async $allOperations({ operation, args, query }) {
        try {
          return await query(args);
        } catch (error) {
          if (!READ_OPERATIONS.has(operation) || !isDroppedConnection(error)) throw error;
          await new Promise((resolve) => setTimeout(resolve, 300));
          return query(args);
        }
      },
    },
  });
}

function buildClient() {
  return withConnectionRetry(new PrismaClient());
}

type Db = ReturnType<typeof buildClient>;

// Prisma client singleton — avoids exhausting connections during Next.js
// hot-reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: Db };

export const db: Db = globalForPrisma.prisma ?? buildClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
