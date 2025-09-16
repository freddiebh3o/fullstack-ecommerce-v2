// src/lib/db/prisma.ts
import { PrismaClient } from "@prisma/client";

const globalForPrisma = globalThis as unknown as { prisma?: PrismaClient };

export const prisma =
  globalForPrisma.prisma ??
  new PrismaClient({
    // keep logs minimal now; we can tune later
  });

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = prisma;
}
