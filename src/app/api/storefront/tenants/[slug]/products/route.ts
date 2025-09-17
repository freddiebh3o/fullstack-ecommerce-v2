// src/app/api/storefront/tenants/[slug]/products/route.ts
import { NextResponse } from "next/server";
import { systemDb } from "@/lib/db/system";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { ok, fail } from "@/lib/utils/http";

export async function GET(req: Request, ctx: { params: Promise<{ slug: string }> }) {
  const { slug } = await ctx.params;

  const tenant = await systemDb.tenant.findUnique({ where: { slug }, select: { id: true, slug: true, name: true }});
  if (!tenant) return fail(404, "Tenant not found");

  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.trim() || "";
  const limit = Math.max(1, Math.min(50, Number(url.searchParams.get("limit") ?? 20)));
  const cursor = url.searchParams.get("cursor");
  const db = prismaForTenant(tenant.id);

  const where: any = { isActive: true };
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }

  const products = await db.product.findMany({
    where,
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      // Public storefront doesn’t leak internal ids by default
      sku: true,
      name: true,
      description: true,
      priceInPence: true,
      currency: true,
      isActive: true,
      updatedAt: true,
    },
  });

  const nextCursor = products.length === limit
    ? (await db.product.findFirst({
        where,
        skip: (cursor ? 1 : 0) + products.length - 1,
        take: 1,
        orderBy: { createdAt: "desc" },
        select: { /* no id in output, but we need cursor internally */ id: true }
      }))?.id ?? null
    : null;

  // Short public cache (can tune later)
  return ok({ tenant: { slug: tenant.slug, name: tenant.name }, products, nextCursor }, {
    headers: { "Cache-Control": "public, max-age=30" }
  });
}
