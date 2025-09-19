// tests/setup.ts
import { prisma, truncateAll } from "./_utils/db";

beforeEach(async () => {
  await truncateAll();
});

afterAll(async () => {
  await prisma.$disconnect();
});
