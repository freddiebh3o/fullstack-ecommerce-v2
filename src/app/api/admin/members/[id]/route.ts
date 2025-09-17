// src/app/api/admin/members/[id]/route.ts
import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { writeAudit, diffForUpdate } from "@/lib/core/audit";
import { withApi } from "@/lib/utils/with-api";

const UpdateCapsInput = z.object({
  caps: z
    .object({
      isOwner: z.boolean().optional(),
      canManageMembers: z.boolean().optional(),
      canManageProducts: z.boolean().optional(),
      canViewProducts: z.boolean().optional(),
    })
    .refine((v) => Object.keys(v).length > 0, { message: "No changes provided" }),
});

export const PATCH = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Caller must manage members; only owners can modify isOwner
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateCapsInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const caps = parsed.data.caps;

  if ("isOwner" in caps && caps.isOwner !== undefined && !me.isOwner) {
    return NextResponse.json({ ok: false, error: "Only owners can modify isOwner" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);

  // Ensure target exists in THIS tenant
  const target = await db.membership.findFirst({
    where: { id },
    select: { id: true, isOwner: true },
  });
  if (!target) return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });

  // If removing isOwner, ensure at least one owner remains
  if (caps.isOwner === false) {
    const owners = await db.membership.count({ where: { isOwner: true } });
    if (owners <= 1) {
      return NextResponse.json(
        { ok: false, error: "Cannot remove the last owner" },
        { status: 409 }
      );
    }
  }

  // Read BEFORE state
  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!before) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Perform update (tenant guard ensures scoping)
  const res = await db.membership.updateMany({ where: { id }, data: caps });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const updated = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  // Audit
  const changedKeys = Object.keys(caps) as (keyof typeof caps)[];
  await writeAudit(db as any, {
    tenantId,
    userId: (session.user as any).id ?? null,
    action: "MEMBERSHIP_UPDATE",
    entityType: "Membership",
    entityId: id,
    diff: {
      before: {
        isOwner: before.isOwner,
        canManageMembers: before.canManageMembers,
        canManageProducts: before.canManageProducts,
        canViewProducts: before.canViewProducts,
      },
      after: {
        isOwner: updated!.isOwner,
        canManageMembers: updated!.canManageMembers,
        canManageProducts: updated!.canManageProducts,
        canViewProducts: updated!.canViewProducts,
      },
    },
    req,
  });

  const data = {
    membershipId: updated!.id,
    userId: updated!.userId,
    user: updated!.user!,
    caps: {
      isOwner: updated!.isOwner,
      canManageMembers: updated!.canManageMembers,
      canManageProducts: updated!.canManageProducts,
      canViewProducts: updated!.canViewProducts,
    },
    updatedAt: updated!.createdAt, // createdAt is what we stored; no updatedAt on membership in v1
  };

  return NextResponse.json({ ok: true, data });
});

export const DELETE = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  const session = await requireSession();

  // Graceful 400 if tenant is missing (instead of throwing 500)
  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return NextResponse.json({ ok: false, error: "No tenant selected" }, { status: 400 });
  }

  // Capability: must manage members
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);

  // Read BEFORE state
  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  // Safe delete
  const res = await db.membership.deleteMany({ where: { id } });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Audit
  await writeAudit(db as any, {
    tenantId,
    userId: (session.user as any).id ?? null,
    action: "MEMBERSHIP_DELETE",
    entityType: "Membership",
    entityId: id,
    diff: before
      ? {
          before: {
            id: before.id,
            userId: before.userId,
            caps: {
              isOwner: before.isOwner,
              canManageMembers: before.canManageMembers,
              canManageProducts: before.canManageProducts,
              canViewProducts: before.canViewProducts,
            },
          },
        }
      : undefined,
    req,
  });

  return NextResponse.json({ ok: true });
});

export const GET = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Capability: must manage products
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden");

  const db = prismaForTenant(tenantId);
  const m = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!m) return fail(404, "Not found");

  return ok({
    membershipId: m.id,
    userId: m.userId,
    user: m.user,
    caps: {
      isOwner: m.isOwner,
      canManageMembers: m.canManageMembers,
      canManageProducts: m.canManageProducts,
      canViewProducts: m.canViewProducts,
    },
    createdAt: m.createdAt,
  });
});

export async function PUT() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
