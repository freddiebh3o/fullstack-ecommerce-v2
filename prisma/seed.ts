// prisma/seed.ts
import { PrismaClient } from "@prisma/client";
import bcrypt from "bcryptjs";

const prisma = new PrismaClient();

async function ensureUser(email: string, password: string) {
  const passwordHash = await bcrypt.hash(password, 12);
  return prisma.user.upsert({
    where: { email },
    create: { email, passwordHash },
    update: { passwordHash }
  });
}

async function ensureTenant(slug: string, name: string) {
  return prisma.tenant.upsert({
    where: { slug },
    create: { slug, name },
    update: { name }
  });
}

async function ensureMembership(userId: string, tenantId: string, caps: Partial<{
  isOwner: boolean;
  canManageMembers: boolean;
  canManageProducts: boolean;
  canViewProducts: boolean;
}>) {
  return prisma.membership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, ...caps },
    update: { ...caps }
  });
}

async function createProduct(tenantId: string, sku: string, name: string, priceInCents: number) {
  return prisma.product.upsert({
    where: { tenantId_sku: { tenantId, sku } },
    create: { tenantId, sku, name, priceInCents },
    update: { name, priceInCents, isActive: true }
  });
}

async function log(
  tenantId: string | null,
  userId: string | null,
  action: string,
  entityType?: string,
  entityId?: string,
  diff?: unknown
) {
  return prisma.auditLog.create({
    data: { tenantId, userId, action, entityType, entityId, diff: diff as any }
  });
}

async function main() {
  // Users
  const alice = await ensureUser("alice@example.com", "password123");
  const bob   = await ensureUser("bob@example.com",   "password123");

  // Tenants
  const acme   = await ensureTenant("acme",   "ACME, Inc.");
  const globex = await ensureTenant("globex", "Globex Corp");

  // Memberships
  await ensureMembership(alice.id, acme.id,   { isOwner: true, canManageMembers: true, canManageProducts: true, canViewProducts: true });
  await ensureMembership(alice.id, globex.id, { canManageProducts: true, canViewProducts: true });
  await ensureMembership(bob.id,   acme.id,   { canViewProducts: true });

  // Products (tenant-scoped)
  await createProduct(acme.id,   "ACM-001", "ACME Hammer",    2499);
  await createProduct(acme.id,   "ACM-002", "ACME Anvil",     9999);
  await createProduct(globex.id, "GLX-100", "Globex Widget",  4999);

  // Audit logs
  await log(acme.id, alice.id, "PRODUCT_CREATE", "Product", "ACM-001", { priceInCents: 2499 });
  await log(acme.id, alice.id, "PRODUCT_CREATE", "Product", "ACM-002", { priceInCents: 9999 });
  await log(globex.id, alice.id, "PRODUCT_CREATE", "Product", "GLX-100", { priceInCents: 4999 });

  console.log("Seed complete ✅");
}

main()
  .then(async () => { await prisma.$disconnect(); })
  .catch(async (e) => { console.error(e); await prisma.$disconnect(); process.exit(1); });
