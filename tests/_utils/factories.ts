// tests/_utils/factories.ts
import type { PrismaClient, User, Tenant, Membership, Product } from "@prisma/client";
import { prisma as prismaClient } from "@/lib/db/prisma";
import { prismaForTenant as tenantClientFactory } from "@/lib/db/tenant-scoped";

/**
 * Cast the app prisma to a plain PrismaClient for tests.
 * We keep this narrow and central so tests can import just from factories.
 */
export const sys = prismaClient as unknown as PrismaClient;

/** Re-export the tenant-scoped factory for convenience in tests */
export const prismaForTenant = tenantClientFactory;

/** Short, readable unique suffix for emails/sku/slug/etc. */
export const uniq = () => Math.random().toString(36).slice(2, 10);

/** Create or fetch a user by email (idempotent for tests) */
export async function mkUser(
  email?: string,
  overrides: Partial<Pick<User, "passwordHash">> = {}
): Promise<User> {
  const e = email ?? `${uniq()}@example.com`;
  return sys.user.upsert({
    where: { email: e },
    create: { email: e, passwordHash: overrides.passwordHash ?? "x" },
    update: {},
  });
}

/** Create or update a tenant by slug (idempotent) */
export async function mkTenant(
  slug?: string,
  name?: string,
  overrides: Partial<Pick<Tenant, "name">> = {}
): Promise<Tenant> {
  const s = slug ?? `ten-${uniq()}`;
  const n = name ?? `Tenant ${s}`;
  return sys.tenant.upsert({
    where: { slug: s },
    create: { slug: s, name: overrides.name ?? n },
    update: { name: overrides.name ?? n },
  });
}

export type Caps = Partial<{
  isOwner: boolean;
  canManageMembers: boolean;
  canManageProducts: boolean;
  canViewProducts: boolean;
}>;

/** Create or update a membership (idempotent on (userId, tenantId)) */
export async function member(
  userId: string,
  tenantId: string,
  caps: Caps = {}
): Promise<Membership> {
  return sys.membership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, ...caps },
    update: { ...caps },
  });
}

/** Create or update a product within a tenant (composite unique on (tenantId, sku)) */
export async function mkProduct(
  tenantId: string,
  sku?: string,
  name?: string,
  overrides: Partial<Pick<Product, "priceInPence" | "name">> = {}
): Promise<Product> {
  const s = sku ?? `SKU-${uniq()}`;
  const n = name ?? `Product ${s}`;
  return sys.product.upsert({
    where: { tenantId_sku: { tenantId, sku: s } },
    create: {
      tenantId,
      sku: s,
      name: overrides.name ?? n,
      priceInPence: overrides.priceInPence ?? 1000,
    },
    update: { name: overrides.name ?? n, priceInPence: overrides.priceInPence ?? 1000 },
  });
}

/**
 * Convenience helper: make a fresh tenant with an owner + DB client.
 * Useful for many integration tests.
 */
export async function mkTenantWithOwner() {
  const t = await mkTenant();
  const u = await mkUser();
  await member(u.id, t.id, { isOwner: true, canManageMembers: true, canManageProducts: true, canViewProducts: true });
  const db = prismaForTenant(t.id);
  return { tenant: t, owner: u, db, tenantId: t.id, userId: u.id };
}
