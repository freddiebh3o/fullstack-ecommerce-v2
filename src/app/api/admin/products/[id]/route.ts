// src/app/api/admin/products/[id]/route.ts
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { ProductUpdateSchema } from "@/lib/core/schemas";
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
  if (reserve.mode === "replay") return ok(reserve.response, 200, req);
  if (reserve.mode === "in_progress") return fail(409, "Request already in progress", undefined, req);

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

  // Capability
  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageProducts: true },
  });
  if (!membership || !membership.canManageProducts) return fail(403, "Forbidden", undefined, req);

  // Validate body
  const body = await req.json().catch(() => null);
  const parsed = ProductUpdateSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const { expectedVersion, ...changes } = parsed.data as any;

  const db = prismaForTenant(tenantId);

  // Read BEFORE (for audit + 404 vs 409 disambiguation)
  const before = await db.product.findFirst({
    where: { id },
    select: {
      id: true, sku: true, name: true, description: true,
      priceInPence: true, currency: true, isActive: true,
      createdAt: true, updatedAt: true, version: true,
    },
  });
  if (!before) return fail(404, "Not found", undefined, req);

  // OCC update: match expectedVersion and bump version atomically
  const res = await db.product.updateMany({
    where: { id, version: expectedVersion },
    data: { ...changes, version: { increment: 1 } },
  });
  
  if (res.count !== 1) {
    // Distinguish missing vs stale version for better client UX
    const exists = await db.product.findFirst({
      where: { id },
      select: { version: true },
    });
    if (!exists) return fail(404, "Not found", undefined, req);
    return fail(409, "Version conflict", { expectedVersion, currentVersion: exists.version }, req);
  }

  // Read AFTER
  const updated = await db.product.findFirst({
    where: { id },
    select: {
      id: true, sku: true, name: true, description: true,
      priceInPence: true, currency: true, isActive: true,
      createdAt: true, updatedAt: true, version: true,
    },
  });

  // Idempotent success
  if (reserve.mode === "reserved") {
    await persistIdempotentSuccess(reserve.fp, 200, updated);
  }

  // Build changed keys for the audit diff and include version if it bumped
  const changedKeys = [
    ...Object.keys(changes),
    ...(before.version !== updated!.version ? ["version"] : []),
  ] as (keyof typeof updated)[];
  
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
      version: true,
    },
  });
  if (!product) return fail(404, "Not found", undefined, req);
  return ok(product, 200, req);
});
