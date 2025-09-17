// tests/tenant-guard.spec.ts
import { describe, test, expect } from "vitest";
import { systemDb } from "@/lib/db/system";
import { prismaForTenant } from "@/lib/db/tenant-scoped";

const sys = systemDb;  
const uniq = () => Math.random().toString(36).slice(2, 10);

async function mkUser(email: string) {
  return sys.user.upsert({ where: { email }, create: { email, passwordHash: "x" }, update: {} });
}
async function mkTenant(slug: string, name: string) {
  return sys.tenant.upsert({ where: { slug }, create: { slug, name }, update: { name } });
}
async function member(
  userId: string,
  tenantId: string,
  caps: Partial<{
    isOwner: boolean;
    canManageMembers: boolean;
    canManageProducts: boolean;
    canViewProducts: boolean;
  }>
) {
  return sys.membership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, ...caps },
    update: { ...caps },
  });
}

async function mkProduct(tenantId: string, sku: string, name: string) {
  return systemDb.product.upsert({
    where: { tenantId_sku: { tenantId, sku } },
    create: { tenantId, sku, name, priceInPence: 1000 },
    update: { name },
  });
}

describe("tenant guard", () => {
  test("auto-scopes reads", async () => {
    const a = await mkTenant(`tga-${uniq()}`, "TGA");
    const b = await mkTenant(`tgb-${uniq()}`, "TGB");
    await mkProduct(a.id, `A-${uniq()}`, "A one");
    await mkProduct(b.id, `B-${uniq()}`, "B one");

    const aDb = prismaForTenant(a.id);
    const bDb = prismaForTenant(b.id);

    const aSkus = (await aDb.product.findMany()).map((p) => p.sku);
    const bSkus = (await bDb.product.findMany()).map((p) => p.sku);

    expect(aSkus.length).toBe(1);
    expect(bSkus.length).toBe(1);
  });

  test("blocks unsafe single-record ops", async () => {
    const t = await mkTenant(`tgc-${uniq()}`, "TGC");
    const p = await mkProduct(t.id, `C-${uniq()}`, "C one");
    const db = prismaForTenant(t.id);

    await expect(db.product.findUnique({ where: { id: p.id } })).rejects.toThrow();
    await expect(db.product.update({ where: { id: p.id }, data: { name: "x" } })).rejects.toThrow();
    await expect(db.product.delete({ where: { id: p.id } })).rejects.toThrow();
  });

  test("allows updateMany and create with injection", async () => {
    const t = await mkTenant(`tgd-${uniq()}`, "TGD");
    const db = prismaForTenant(t.id);

    const created = await db.product.create({
      data: {
        // You can use either form; both satisfy Prisma types.
        // Using unchecked is simple for tests and plays nice with your guard.
        tenantId: t.id,
        sku: `D-${uniq()}`,
        name: "D one",
        priceInPence: 1111,
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
    const t = await mkTenant(`tge-${uniq()}`, "TGE");
    const db = prismaForTenant(t.id);

    const sku1 = `E-${uniq()}`;
    await expect(
      db.product.upsert({
        where: { tenantId_sku: { tenantId: t.id, sku: sku1 } }, // ✅ composite
        create: {
          tenantId: t.id,
          sku: sku1,
          name: "E one",
          priceInPence: 2000,
        },
        update: { name: "E one v2" },
      })
    ).resolves.toBeDefined();

    // ❌ bad: upsert keyed by id only (no tenant in unique)
    await expect(
      db.product.upsert({
        where: { id: "not-a-real-id" },
        create: {
          tenantId: t.id,
          sku: `E-${uniq()}`,
          name: "x",
          priceInPence: 1,
        },
        update: { name: "y" },
      })
    ).rejects.toThrow();
  });
});
