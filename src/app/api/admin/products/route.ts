// src/app/api/admin/products/route.ts
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ok, fail } from "@/lib/utils/http";
import { isUniqueViolation } from "@/lib/utils/prisma-errors";
import { ProductCreateSchema } from "@/lib/core/schemas";
import { writeAudit } from "@/lib/core/audit";
import { withApi } from "@/lib/utils/with-api";
import { loggerForRequest } from "@/lib/log/log";
import { rateLimitFixedWindow } from "@/lib/security/rate-limit";
import { reserveIdempotency, persistIdempotentSuccess } from "@/lib/security/idempotency";
import { getTenantId } from "@/lib/tenant/context";

export const GET = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = getTenantId();
  if (!tenantId) return fail(404, "Tenant not resolved", undefined, req);

  const me = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const { searchParams } = new URL(req.url);
  const q = searchParams.get("q")?.trim() || undefined;
  const limit = Math.min(Math.max(Number(searchParams.get("limit") ?? 25), 1), 100);
  const cursor = searchParams.get("cursor") || undefined;

  const db = prismaForTenant(tenantId);
  const items = await db.product.findMany({
    where: q
      ? {
          OR: [
            { name: { contains: q, mode: "insensitive" } },
            { sku: { contains: q, mode: "insensitive" } },
          ],
        }
      : undefined,
    take: limit,
    ...(cursor ? { cursor: { id: cursor }, skip: 1 } : {}),
    orderBy: { createdAt: "desc" },
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
      version: true,
    },
  });

  const nextCursor = items.length === limit ? items[items.length - 1].id : null;
  return ok({ items, nextCursor }, 200, req);
});

export const POST = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = getTenantId();
  if (!tenantId) return fail(404, "Tenant not resolved", undefined, req);

  // Idempotency reservation / replay
  const userId = session.user.id ?? null;
  const reserve = await reserveIdempotency(req, userId, tenantId);
  if (reserve.mode === "replay") {
    return ok(reserve.response, 201, req);
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

  const me = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const body = await req.json().catch(() => null);
  const parsed = ProductCreateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const data = parsed.data;

  const db = prismaForTenant(tenantId);
  try {
    const created = await db.product.create({
      data: {
        tenant: { connect: { id: tenantId } },
        sku: data.sku,
        name: data.name,
        description: data.description ?? null,
        priceInPence: data.priceInPence,
        currency: data.currency ?? "GBP",
        isActive: data.isActive ?? true,
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
        version: true, // ← added
      },
    });

    await writeAudit(db, {
      tenantId,
      userId: session.user.id ?? null,
      action: "PRODUCT_CREATE",
      entityType: "Product",
      entityId: created.id,
      diff: {
        after: {
          id: created.id,
          sku: created.sku,
          name: created.name,
          priceInPence: created.priceInPence,
          currency: created.currency,
          isActive: created.isActive,
        },
      },
      req,
    });

    if (reserve.mode === "reserved") {
      await persistIdempotentSuccess(reserve.fp, 201, created);
    }

    return ok(created, 201, req);
  } catch (e) {
    if (isUniqueViolation(e, ["tenantId", "sku", "tenantId_sku", "Product_tenantId_sku_key"])) {
      return fail(409, "SKU already exists for this tenant", undefined, req);
    }
    throw e;
  }
});
