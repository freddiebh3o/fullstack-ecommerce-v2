// src/app/api/admin/members/[id]/route.ts
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { writeAudit } from "@/lib/core/audit";
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

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const body = await req.json().catch(() => null);
  const parsed = UpdateCapsInput.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const caps = parsed.data.caps;

  if ("isOwner" in caps && caps.isOwner !== undefined && !me.isOwner) {
    return fail(403, "Only owners can modify isOwner", undefined, req);
  }

  const db = prismaForTenant(tenantId);

  const target = await db.membership.findFirst({
    where: { id },
    select: { id: true, isOwner: true },
  });
  if (!target) return fail(404, "Not found", undefined, req);

  if (caps.isOwner === false) {
    const owners = await db.membership.count({ where: { isOwner: true } });
    if (owners <= 1) return fail(409, "Cannot remove the last owner", undefined, req);
  }

  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!before) return fail(404, "Not found", undefined, req);

  const res = await db.membership.updateMany({ where: { id }, data: caps });
  if (res.count !== 1) return fail(404, "Not found", undefined, req);

  const updated = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

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

  return ok(
    {
      membershipId: updated!.id,
      userId: updated!.userId,
      user: updated!.user!,
      caps: {
        isOwner: updated!.isOwner,
        canManageMembers: updated!.canManageMembers,
        canManageProducts: updated!.canManageProducts,
        canViewProducts: updated!.canViewProducts,
      },
      updatedAt: updated!.createdAt,
    },
    200,
    req
  );
});

export const DELETE = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  const session = await requireSession();

  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return fail(400, "No tenant selected", undefined, req);
  }

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);

  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const res = await db.membership.deleteMany({ where: { id } });
  if (res.count !== 1) return fail(404, "Not found", undefined, req);

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

  return ok({ deleted: true }, 200, req);
});

export const GET = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);
  const m = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!m) return fail(404, "Not found", undefined, req);

  return ok(
    {
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
    },
    200,
    req
  );
});
