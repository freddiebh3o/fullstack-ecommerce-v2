import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ProductUpdateInput as ProductUpdateSchema } from "@/lib/validation/product";
import { ok, fail } from "@/lib/utils/http";
import { z } from "zod";

export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();
  const { id } = await params;

  // Capability: must manage products
  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  // Validate input
  const body = await req.json().catch(() => null);
  const parsed = ProductUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const db = prismaForTenant(tenantId);

  // Safe update: tenant guard injects tenantId; single-record ops are blocked,
  // so we use updateMany + then read back the document.
  const res = await db.product.updateMany({ where: { id }, data: parsed.data });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const updated = await db.product.findFirst({
    where: { id },
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

  return NextResponse.json({ ok: true, data: updated });
}

export async function DELETE(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Capability: must manage products
  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);

  // Safe delete with tenant-guard via deleteMany
  const res = await db.product.deleteMany({ where: { id } });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  return NextResponse.json({ ok: true });
}

export async function GET(_req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden");

  const db = prismaForTenant(tenantId);
  const product = await db.product.findFirst({
    where: { id },
    select: {
      id: true, sku: true, name: true, description: true,
      priceInPence: true, currency: true, isActive: true,
      createdAt: true, updatedAt: true,
    }
  });
  if (!product) return fail(404, "Not found");
  return ok(product);
}