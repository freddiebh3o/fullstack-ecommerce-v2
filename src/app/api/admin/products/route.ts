import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { isUniqueViolation } from "@/lib/utils/prisma-errors";
import { ProductCreateSchema } from "@/lib/core/schemas";

export async function GET(req: Request) {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden");

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || "";
  const active = searchParams.get("active");   // "true" | "false" | null
  const limit = Math.max(1, Math.min(50, Number(searchParams.get("limit") ?? 20)));
  const cursor = searchParams.get("cursor") || null;

  const db = prismaForTenant(tenantId);

  const where: any = {};
  if (q) {
    where.OR = [
      { sku: { contains: q, mode: "insensitive" } },
      { name: { contains: q, mode: "insensitive" } },
      { description: { contains: q, mode: "insensitive" } },
    ];
  }
  if (active === "true") where.isActive = true;
  if (active === "false") where.isActive = false;

  const items = await db.product.findMany({
    where,
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
    select: {
      id: true, sku: true, name: true, description: true,
      priceInPence: true, currency: true, isActive: true,
      createdAt: true, updatedAt: true,
    }
  });

  const nextCursor = items.length === limit ? items[items.length - 1].id : null;
  return ok({ items, nextCursor });
}

export async function POST(req: Request) {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden");

  const body = await req.json().catch(() => null);
  const parsed = ProductCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() });
  }
  const data = parsed.data;

  const db = prismaForTenant(tenantId);
  try {
    const created = await db.product.create({
      data: {
        ...data,
        tenant: { connect: { id: tenantId } }, // type-safe, guard also normalizes
      },
      select: {
        id: true, sku: true, name: true, description: true,
        priceInPence: true, currency: true, isActive: true,
        createdAt: true, updatedAt: true,
      }
    });
    return ok(created, 201);
  } catch (e) {
    if (isUniqueViolation(e, ["tenantId", "sku", "tenantId_sku", "Product_tenantId_sku_key"])) {
      return fail(409, "SKU already exists for this tenant");
    }
    throw e;
  }
}
