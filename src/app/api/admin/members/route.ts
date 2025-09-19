// src/app/api/admin/members/route.ts
import { MemberCreateSchema } from "@/lib/core/schemas";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";
import { writeAudit } from "@/lib/core/audit";
import { isUniqueViolation } from "@/lib/utils/prisma-errors";
import { loggerForRequest } from "@/lib/log/log";
import { rateLimitFixedWindow } from "@/lib/security/rate-limit";
import { reserveIdempotency, persistIdempotentSuccess } from "@/lib/security/idempotency";

// GET: list members for current tenant
export const GET = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return fail(403, "Forbidden", undefined, req);
  }

  const db = prismaForTenant(tenantId);
  const members = await db.membership.findMany({
    orderBy: { createdAt: "asc" },
    select: {
      id: true,
      userId: true,
      isOwner: true,
      canManageMembers: true,
      canManageProducts: true,
      canViewProducts: true,
      createdAt: true,
      updatedAt: true,
      version: true,
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const data = members.map((m) => ({
    membershipId: m.id,
    userId: m.userId,
    user: m.user!,
    caps: {
      isOwner: m.isOwner,
      canManageMembers: m.canManageMembers,
      canManageProducts: m.canManageProducts,
      canViewProducts: m.canViewProducts,
    },
    createdAt: m.createdAt,
    updatedAt: m.updatedAt,
    version: m.version,
  }));

  return ok({ data }, 200, req);
});

// POST: attach existing user to this tenant (idempotent + rate-limited)
export const POST = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const userId = (session.user as any).id ?? null;

  const reserve = await reserveIdempotency(req, userId, tenantId);
  if (reserve.mode === "replay") {
    return ok(reserve.response, 201, req);
  }
  if (reserve.mode === "in_progress") {
    return fail(409, "Request already in progress", undefined, req);
  }

  const { log, requestId } = loggerForRequest(req);
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

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return fail(403, "Forbidden", undefined, req);
  }

  const body = await req.json().catch(() => null);
  const parsed = MemberCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const { email, caps } = parsed.data;

  if (caps.isOwner === true && !me.isOwner) {
    return fail(403, "Only owners can set isOwner", undefined, req);
  }

  const user = await systemDb.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return fail(404, "User not found", undefined, req);
  }

  try {
    const created = await systemDb.membership.create({
      data: {
        userId: user.id,
        tenantId,
        isOwner: !!caps.isOwner,
        canManageMembers: !!caps.canManageMembers,
        canManageProducts: !!caps.canManageProducts,
        canViewProducts: caps.canViewProducts ?? true,
      },
      select: {
        id: true,
        userId: true,
        createdAt: true,
        updatedAt: true,
        version: true,
        isOwner: true,
        canManageMembers: true,
        canManageProducts: true,
        canViewProducts: true,
      },
    });

    await writeAudit(systemDb as any, {
      tenantId,
      userId: (session.user as any).id ?? null,
      action: "MEMBERSHIP_CREATE",
      entityType: "Membership",
      entityId: created.id,
      diff: {
        after: {
          id: created.id,
          userId: created.userId,
          caps: {
            isOwner: created.isOwner,
            canManageMembers: created.canManageMembers,
            canManageProducts: created.canManageProducts,
            canViewProducts: created.canViewProducts,
          },
        },
      },
      req,
    });

    const apiData = {
      membershipId: created.id,
      userId: user.id,
      user,
      caps: {
        isOwner: created.isOwner,
        canManageMembers: created.canManageMembers,
        canManageProducts: created.canManageProducts,
        canViewProducts: created.canViewProducts,
      },
      createdAt: created.createdAt,
      updatedAt: created.updatedAt,
      version: created.version,
    };

    if (reserve.mode === "reserved") {
      await persistIdempotentSuccess(reserve.fp, 201, apiData);
    }

    return ok(apiData, 201, req);
  } catch (e) {
    if (isUniqueViolation(e, ["userId", "tenantId", "userId_tenantId"])) {
      return fail(409, "User is already a member of this tenant", undefined, req);
    }
    throw e;
  }
});
