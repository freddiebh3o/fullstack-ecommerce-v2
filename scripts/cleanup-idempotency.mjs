// scripts/cleanup-idempotency.mjs
import 'dotenv/config';
import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

async function main() {
  const hours = Number(process.env.IDEMPOTENCY_TTL_HOURS || 24);
  const cutoff = new Date(Date.now() - hours * 60 * 60 * 1000);

  const deleted = await prisma.idempotencyKey.deleteMany({
    where: { createdAt: { lt: cutoff } },
  });

  console.log(
    `[cleanup-idempotency] cutoff=${cutoff.toISOString()} hours=${hours} deleted=${deleted.count}`
  );
}

main()
  .catch((e) => {
    console.error('[cleanup-idempotency] error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
