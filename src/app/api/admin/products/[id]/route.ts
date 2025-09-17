// src/app/api/admin/products/[id]/route.ts
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ProductUpdateInput as ProductUpdateSchema } from "@/lib/validation/product";
import { ok, fail } from "@/lib/utils/http";
import { writeAudit, diffForUpdate } from "@/lib/core/audit";
import { withApi } from "@/lib/utils/with-api";
import { loggerForRequest } from "@/lib/log/log";
import { rateLimitFixedWindow } from "@/lib/security/rate-limit";
import { reserveIdempotency, persistIdempotentSuccess } from "@/lib/security/idempotency";

export const PATCH = withApi(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();
  const { id } = await params;

  // Idempotency
  const userId = (session.user as any).id ?? null;
  const reserve = await reserveIdempotency(req, userId, tenantId);
  if (reserve.mode === "replay") {
    return ok(reserve.response, 200, req);
  }
  if (reserve.mode === "in_progress") {
    return fail(409, "Request already in progress", undefined, req);
  }

  const { log } = loggerForRequest(req);
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


  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const body = await req.json().catch(() => null);
  const parsed = ProductUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }

  const db = prismaForTenant(tenantId);

  const before = await db.product.findFirst({
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
  if (!before) return fail(404, "Not found", undefined, req);

  const res = await db.product.updateMany({ where: { id }, data: parsed.data });
  if (res.count !== 1) return fail(404, "Not found", undefined, req);

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

  if (reserve.mode === "reserved") {
    await persistIdempotentSuccess(reserve.fp, 200, updated);
  }

  const changedKeys = Object.keys(parsed.data) as (keyof typeof updated)[];
  await writeAudit(db as any, {
    tenantId,
    userId: (session.user as any).id ?? null,
    action: "PRODUCT_UPDATE",
    entityType: "Product",
    entityId: id,
    diff: diffForUpdate(before as any, updated as any, changedKeys as any),
    req,
  });
  

  return ok(updated, 200, req);
});

export const DELETE = withApi(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const { id } = await params;
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

  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);

  const before = await db.product.findFirst({
    where: { id },
    select: { id: true, sku: true, name: true },
  });

  const res = await db.product.deleteMany({ where: { id } });
  if (res.count !== 1) return fail(404, "Not found", undefined, req);

  await writeAudit(db as any, {
    tenantId,
    userId: (session.user as any).id ?? null,
    action: "PRODUCT_DELETE",
    entityType: "Product",
    entityId: id,
    diff: before ? { before } : undefined,
    req,
  });

  return ok({ deleted: true }, 200, req);
});

export const GET = withApi(async (req: Request, { params }: { params: Promise<{ id: string }> }) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();
  const { id } = await params;

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!me || !me.canManageProducts) return fail(403, "Forbidden", undefined, req);

  const db = prismaForTenant(tenantId);
  const product = await db.product.findFirst({
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
  if (!product) return fail(404, "Not found", undefined, req);
  return ok(product, 200, req);
});
