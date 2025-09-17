// tests/setup.ts
import { prisma as client } from "@/lib/db/prisma";
import type { PrismaClient } from "@prisma/client";
const prisma = client as unknown as PrismaClient;

beforeEach(async () => {
  await prisma.$executeRawUnsafe(`
    TRUNCATE TABLE
      "AuditLog",
      "Product",
      "Membership",
      "Domain",
      "Tenant",
      "User"
    RESTART IDENTITY CASCADE
  `);
});

afterAll(async () => {
  await prisma.$disconnect();
});
