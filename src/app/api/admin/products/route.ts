import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ProductCreateInput as ProductCreateSchema } from "@/lib/validation/product";

export async function GET() {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canViewProducts: true },
  });
  if (!membership || !membership.canViewProducts) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);
  const products = await db.product.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      sku: true,
      name: true,
      description: true,
      priceInPence: true,
      currency: true,
      isActive: true,
      createdAt: true,
      updatedAt: true,
    },
  });

  return NextResponse.json({ ok: true, data: products });
}

export async function POST(req: Request) {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Capability: need manage permission
  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // Validate input
  const body = await req.json().catch(() => null);
  const parsed = ProductCreateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const db = prismaForTenant(tenantId);

  try {
    const created = await db.product.create({
      data: {
        ...parsed.data,
        // Prisma type wants relation; guard enforces it matches tenantId
        tenant: { connect: { id: tenantId } },
      },
      select: {
        id: true,
        sku: true,
        name: true,
        description: true,
        priceInPence: true,
        currency: true,
        isActive: true,
        createdAt: true,
        updatedAt: true,
      },
    });

    return NextResponse.json({ ok: true, data: created });
  } catch (err: any) {
    if (err?.code === "P2002") {
      // unique constraint — likely (tenantId, sku)
      return NextResponse.json(
        { ok: false, error: "SKU already exists for this tenant" },
        { status: 409 }
      );
    }
    console.error("[POST /admin/products] error", err);
    return NextResponse.json({ ok: false, error: "Server error" }, { status: 500 });
  }
}
