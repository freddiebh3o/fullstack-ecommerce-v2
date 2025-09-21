// src/app/api/admin/members/[id]/route.ts
import { MemberUpdateCapsSchema } from "@/lib/core/schemas";
import { requireSession } from "@/lib/auth/session";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { writeAudit } from "@/lib/core/audit";
import { withApi } from "@/lib/utils/with-api";
import { loggerForRequest } from "@/lib/log/log";
import { rateLimitFixedWindow } from "@/lib/security/rate-limit";
import { reserveIdempotency, persistIdempotentSuccess } from "@/lib/security/idempotency";
import { getTenantId } from "@/lib/tenant/context";

export const PATCH = withApi(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
  const session = await requireSession();
  const tenantId = getTenantId();
  if (!tenantId) return fail(404, "Tenant not resolved", undefined, req);

  const userId = session.user.id ?? null;

  // Idempotency
  const reserve = await reserveIdempotency(req, userId, tenantId);
  if (reserve.mode === "replay") {
    return ok(reserve.response, 200, req);
  }
  if (reserve.mode === "in_progress") {
    return fail(409, "Request already in progress", undefined, req);
  }

  // Per-user mutation cap
  const { log } = loggerForRequest(req);
  const uStats = rateLimitFixedWindow({
    key: `mut:user:${userId}`,
    limit: Number(process.env.RL_MUTATION_PER_USER_PER_MIN || 60),
    windowMs: 60_000,
  });
  if (!uStats.ok) {
    log.warn({ event: "rate_limited", scope: "mut:user", userId, ...uStats });
    return fail(
      429,
      "Too Many Requests",
      undefined,
      req,
      {
        headers: {
          "Retry-After": String(uStats.retryAfter ?? 60),
          "X-RateLimit-Limit": String(uStats.limit),
          "X-RateLimit-Remaining": String(uStats.remaining),
        },
      }
    );
  }

  // Caller must manage members; only owners can modify isOwner
  const me = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return fail(403, "Forbidden", undefined, req);
  }

  const body = await req.json().catch(() => null);
  const parsed = MemberUpdateCapsSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const { expectedVersion, caps } = parsed.data;

  if ("isOwner" in caps && caps.isOwner !== undefined && !me.isOwner) {
    return fail(403, "Only owners can modify isOwner", undefined, req);
  }

  const db = prismaForTenant(tenantId);

  // Ensure target exists in THIS tenant (also gives us current version & user for audit)
  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });
  if (!before) return fail(404, "Not found", undefined, req);

  // If removing isOwner, ensure at least one owner remains
  if (caps.isOwner === false) {
    const owners = await db.membership.count({ where: { isOwner: true } });
    if (owners <= 1) {
      return fail(409, "Cannot remove the last owner", undefined, req);
    }
  }

  // === OCC update: must match expectedVersion ===
  const updateRes = await db.membership.updateMany({
    where: { id, version: expectedVersion },
    data: { ...caps, version: { increment: 1 } },
  });

  if (updateRes.count !== 1) {
    // Distinguish missing vs stale
    const exists = await db.membership.findFirst({
      where: { id },
      select: { version: true },
    });
    if (!exists) return fail(404, "Not found", undefined, req);
    return fail(409, "Version conflict", { expectedVersion, currentVersion: exists.version }, req);
  }

  const updated = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const apiData = {
    membershipId: updated!.id,
    userId: updated!.userId,
    user: updated!.user!,
    caps: {
      isOwner: updated!.isOwner,
      canManageMembers: updated!.canManageMembers,
      canManageProducts: updated!.canManageProducts,
      canViewProducts: updated!.canViewProducts,
    },
    version: updated!.version,
    updatedAt: updated!.updatedAt,
  };

  // Idempotent success (200)
  if (reserve.mode === "reserved") {
    await persistIdempotentSuccess(reserve.fp, 200, apiData);
  }

  // Audit
  await writeAudit(db, {
    tenantId,
    userId: session.user.id ?? null,
    action: "MEMBERSHIP_UPDATE",
    entityType: "Membership",
    entityId: id,
    diff: {
      before: {
        isOwner: before.isOwner,
        canManageMembers: before.canManageMembers,
        canManageProducts: before.canManageProducts,
        canViewProducts: before.canViewProducts,
        version: before.version,
      },
      after: {
        isOwner: updated!.isOwner,
        canManageMembers: updated!.canManageMembers,
        canManageProducts: updated!.canManageProducts,
        canViewProducts: updated!.canViewProducts,
        version: updated!.version,
      },
    },
    req,
  });

  return ok(apiData, 200, req);
});

export const DELETE = withApi(async (req: Request, ctx: { params: Promise<{ id: string }> }) => {
  const { id } = await ctx.params;

  const session = await requireSession();

  const tenantId = getTenantId();
  if (!tenantId) return fail(404, "Tenant not resolved", undefined, req);

  const me = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);

  const before = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  if (before?.isOwner) {
    const owners = await db.membership.count({ where: { isOwner: true } });
    if (owners <= 1) {
      return fail(409, "Cannot remove the last owner", undefined, req);
    }
  }

  const res = await db.membership.deleteMany({ where: { id } });
  if (res.count !== 1) return fail(404, "Not found", undefined, req);

  await writeAudit(db, {
    tenantId,
    userId: session.user.id ?? null,
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
  const tenantId = getTenantId();
  if (!tenantId) return fail(404, "Tenant not resolved", undefined, req);

  const me = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    select: { canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);
  const m = await db.membership.findFirst({
    where: { id },
    select: {
      id: true,
      userId: true,
      isOwner: true,
      canManageMembers: true,
      canManageProducts: true,
      canViewProducts: true,
      createdAt: true,
      updatedAt: true, // ← added
      version: true,   // ← added
      user: { select: { id: true, email: true, name: true } },
    },
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
      updatedAt: m.updatedAt, // ← added
      version: m.version,     // ← added
    },
    200,
    req
  );
});
