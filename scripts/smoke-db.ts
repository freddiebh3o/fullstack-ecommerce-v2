import { PrismaClient } from "@prisma/client";
const db = new PrismaClient();

async function main() {
  const tenants = await db.tenant.findMany({ include: { products: true, memberships: true } });
  for (const t of tenants) {
    console.log(`Tenant ${t.slug} — products: ${t.products.length}, members: ${t.memberships.length}`);
  }
  const logs = await db.auditLog.count();
  console.log(`Audit logs: ${logs}`);
}
main().finally(() => db.$disconnect());
