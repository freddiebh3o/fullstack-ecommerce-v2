// src/app/api/storefront/tenants/[slug]/products/[sku]/route.ts
import { systemDb } from "@/lib/db/system";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { ok, fail } from "@/lib/utils/http";

export async function GET(_req: Request, ctx: { params: Promise<{ slug: string; sku: string }> }) {
  const { slug, sku } = await ctx.params;

  const tenant = await systemDb.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, name: true }});
  if (!tenant) return fail(404, "Tenant not found");

  const db = prismaForTenant(tenant.id);
  const p = await db.product.findFirst({
    where: { sku, isActive: true },
    select: {
      sku: true,
      name: true,
      description: true,
      priceInPence: true,
      currency: true,
      isActive: true,
      updatedAt: true,
    },
  });

  if (!p) return fail(404, "Product not found");
  return ok({ tenant: { slug: tenant.slug, name: tenant.name }, product: p }, {
    headers: { "Cache-Control": "public, max-age=60" }
  });
}
