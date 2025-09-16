// scripts/smoke-tenant.ts
import { prisma } from "@/lib/db/prisma";
import { prismaForTenant } from "@/lib/db/tenant-scoped";

async function main() {
  const acme = await prisma.tenant.findUnique({ where: { slug: "acme" } });
  const globex = await prisma.tenant.findUnique({ where: { slug: "globex" } });
  if (!acme || !globex) throw new Error("Seed missing tenants");

  const acmeDb = prismaForTenant(acme.id);
  const globexDb = prismaForTenant(globex.id);

  const acmeSkus = (await acmeDb.product.findMany()).map(p => p.sku);
  const globexSkus = (await globexDb.product.findMany()).map(p => p.sku);
  console.log("ACME SKUs:", acmeSkus.join(", "));
  console.log("GLOBEX SKUs:", globexSkus.join(", "));

  // Cross-tenant create (explicit wrong tenantId) should be blocked
  try {
    await acmeDb.product.create({
      data: { tenantId: globex.id, sku: "X-ILLEGAL", name: "Illegal", priceInPence: 1 }
    });
    console.log("Cross-tenant create was NOT blocked");
  } catch {
    console.log("Cross-tenant create blocked");
  }

  // Disallowed single-record update
  try {
    const some = (await acmeDb.product.findMany())[0];
    await acmeDb.product.update({ where: { id: some.id }, data: { name: "Nope" } });
    console.log("Unsafe update was NOT blocked");
  } catch {
    console.log("Unsafe update blocked");
  }

  // Safe update with updateMany (tenantId auto-injected)
  const target = (await acmeDb.product.findMany())[0];
  await acmeDb.product.updateMany({ where: { id: target.id }, data: { name: "Renamed ✔" } });
  const refreshed = await acmeDb.product.findFirst({ where: { id: target.id } });
  console.log("Renamed result:", refreshed?.name);
}

main()
  .catch((e) => { console.error(e); process.exit(1); })
  .finally(() => prisma.$disconnect());