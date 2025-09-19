// tests/_utils/db.ts
import type { PrismaClient } from "@prisma/client";
import { prisma as appPrisma } from "@/lib/db/prisma";
export { prismaForTenant } from "@/lib/db/tenant-scoped";

/**
 * Cast the app prisma to a plain PrismaClient for tests.
 * Keep this the single place where we touch the app client.
 */
export const prisma = appPrisma as unknown as PrismaClient;

/**
 * Danger: truncates all app tables.
 * Uses RESTART IDENTITY CASCADE to reset sequences and respect FKs.
 *
 * If you're worried about safety, add a guard here to ensure a TEST DB.
 */
export async function truncateAll() {
  // Optional safety guard:
  // if (process.env.NODE_ENV !== "test") {
  //   throw new Error("Refusing to truncate outside of test environment");
  // }

  // Keep this list in sync with your Prisma schema models
  // Order doesn’t matter with CASCADE, but explicit list keeps intent clear.
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "Product",
      "Membership",
      "Domain",
      "IdempotencyKey",
      "Tenant",
      "User"
    RESTART IDENTITY CASCADE
  `);
}
