import { systemDb } from "@/lib/db/system";
import { prismaForTenant } from "@/lib/db/tenant-scoped";

async function mkTenant(slug: string, name: string) {
  return systemDb.tenant.upsert({
    where: { slug },
    create: { slug, name },
    update: { name }
  });
}

async function mkProduct(tenantId: string, sku: string, name: string) {
  return systemDb.product.upsert({
    where: { tenantId_sku: { tenantId, sku } },
    create: { tenantId, sku, name, priceInCents: 1000 },
    update: { name }
  });
}

describe("tenant guard", () => {
  test("auto-scopes reads", async () => {
    const a = await mkTenant("tga", "TGA");
    const b = await mkTenant("tgb", "TGB");
    await mkProduct(a.id, "A-1", "A one");
    await mkProduct(b.id, "B-1", "B one");

    const aDb = prismaForTenant(a.id);
    const bDb = prismaForTenant(b.id);

    const aSkus = (await aDb.product.findMany()).map(p => p.sku);
    const bSkus = (await bDb.product.findMany()).map(p => p.sku);

    expect(aSkus).toEqual(["A-1"]);
    expect(bSkus).toEqual(["B-1"]);
  });

  test("blocks unsafe single-record ops", async () => {
    const t = await mkTenant("tgc", "TGC");
    const p = await mkProduct(t.id, "C-1", "C one");
    const db = prismaForTenant(t.id);

    await expect(db.product.findUnique({ where: { id: p.id } })).rejects.toThrow();
    await expect(db.product.update({ where: { id: p.id }, data: { name: "x" } })).rejects.toThrow();
    await expect(db.product.delete({ where: { id: p.id } })).rejects.toThrow();
  });

  test("allows updateMany and create with injection", async () => {
    const t = await mkTenant("tgd", "TGD");
    const db = prismaForTenant(t.id);
  
    const created = await db.product.create({
      data: {
        sku: "D-1",
        name: "D one",
        priceInCents: 1111,
        // ⬇️ satisfy Prisma type; guard validates it equals t.id
        tenant: { connect: { id: t.id } },
      },
    });
    expect(created.tenantId).toBe(t.id);
  
    const res = await db.product.updateMany({
      where: { id: created.id },
      data: { name: "D one (renamed)" },
    });
    expect(res.count).toBe(1);
  });

  test("upsert requires composite unique including tenantId", async () => {
    const t = await mkTenant("tge", "TGE");
    const db = prismaForTenant(t.id);
  
    // ✅ good: composite unique includes tenantId
    await expect(
      db.product.upsert({
        where: { tenantId_sku: { tenantId: t.id, sku: "E-1" } },
        create: {
          sku: "E-1",
          name: "E one",
          priceInCents: 2000,
          tenant: { connect: { id: t.id } }, // ⬅️ added
        },
        update: { name: "E one v2" },
      })
    ).resolves.toBeDefined();
  
    // ❌ bad: upsert keyed by id only (no tenant in unique)
    await expect(
      db.product.upsert({
        where: { id: "not-a-real-id" }, // unique does NOT include tenantId
        create: {
          sku: "E-2",
          name: "x",
          priceInCents: 1,
          tenant: { connect: { id: t.id } }, // still required by type; guard checks 'where'
        },
        update: { name: "y" },
      })
    ).rejects.toThrow();
  });
});
