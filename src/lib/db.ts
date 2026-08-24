import { PrismaClient } from "@prisma/client";

// Prisma client singleton — avoids exhausting connections during Next.js
// hot-reload in development.
const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const db = globalForPrisma.prisma ?? new PrismaClient();

if (process.env.NODE_ENV !== "production") globalForPrisma.prisma = db;
