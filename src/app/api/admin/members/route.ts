// src/app/api/admin/members/route.ts
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { z } from "zod";
import { writeAudit } from "@/lib/core/audit";
import { ok, fail } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";
import { loggerForRequest } from "@/lib/log/log";
import { rateLimitFixedWindow } from "@/lib/security/rate-limit";

const CreateMemberInput = z.object({
  email: z.string().email(),
  caps: z
    .object({
      isOwner: z.boolean().optional(),
      canManageMembers: z.boolean().optional(),
      canManageProducts: z.boolean().optional(),
      canViewProducts: z.boolean().optional(),
    })
    .default({}),
});

export const GET = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);
  const memberships = await db.membership.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  return ok(
    {
      data: memberships.map((m) => ({
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
      })),
    },
    200,
    req
  );
});

export const POST = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();
  const { log } = loggerForRequest(req);
  const userId = (session.user as any).id as string;
  const uStats = rateLimitFixedWindow({
    key: `mut:user:${userId}`,
    limit: Number(process.env.RL_MUTATION_PER_USER_PER_MIN || 60),
    windowMs: 60_000,
  });
  if (!uStats.ok) {
    log.warn({ event: "rate_limited", scope: "mut:user", userId, ...uStats });
    const res = fail(429, "Too Many Requests", undefined, req);
    res.headers.set("Retry-After", String(uStats.retryAfter ?? 60));
    res.headers.set("X-RateLimit-Limit", String(uStats.limit));
    res.headers.set("X-RateLimit-Remaining", String(uStats.remaining));
    return res;
  }

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) return fail(403, "Forbidden", undefined, req);

  const body = await req.json().catch(() => null);
  const parsed = CreateMemberInput.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const { email, caps } = parsed.data;

  const user = await systemDb.user.findUnique({ where: { email } });
  if (!user) return fail(404, "User not found", undefined, req);

  const db = prismaForTenant(tenantId);
  const created = await db.membership.create({
    data: {
      tenant: { connect: { id: tenantId } },
      user: { connect: { id: user.id } },
      ...caps,
    },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const data = {
    membershipId: created.id,
    userId: created.userId,
    user: created.user,
    caps: {
      isOwner: created.isOwner,
      canManageMembers: created.canManageMembers,
      canManageProducts: created.canManageProducts,
      canViewProducts: created.canViewProducts,
    },
    createdAt: created.createdAt,
  };

  await writeAudit(db as any, {
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

  return ok({ data }, 201, req);
});
