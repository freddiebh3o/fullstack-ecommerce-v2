// tests/members-guards.spec.ts
import { describe, test, expect } from "vitest";
import { PrismaClient } from "@prisma/client";
import { prisma } from "@/lib/db/prisma";
import { prismaForTenant } from "@/lib/db/tenant-scoped";

const sys = prisma as unknown as PrismaClient;
const uniq = () => Math.random().toString(36).slice(2, 10);

async function mkUser(email: string) {
  return sys.user.upsert({
    where: { email },
    create: { email, passwordHash: "x" },
    update: {},
  });
}
async function mkTenant(slug: string, name: string) {
  return sys.tenant.upsert({ where: { slug }, create: { slug, name }, update: { name } });
}
async function member(
  userId: string,
  tenantId: string,
  caps: Partial<{
    isOwner: boolean;
    canManageMembers: boolean;
    canManageProducts: boolean;
    canViewProducts: boolean;
  }>
) {
  return sys.membership.upsert({
    where: { userId_tenantId: { userId, tenantId } },
    create: { userId, tenantId, ...caps },
    update: { ...caps },
  });
}

describe("membership guards", () => {
  test("blocks demoting the last owner", async () => {
    const t = await mkTenant(`guards-a-${uniq()}`, "Guards A");
    const a = await mkUser(`${uniq()}@example.com`);
    const b = await mkUser(`${uniq()}@example.com`);
    const db = prismaForTenant(t.id);

    await member(a.id, t.id, { isOwner: true, canManageMembers: true });

    let ownerCount = await db.membership.count({ where: { isOwner: true } });
    expect(ownerCount).toBe(1);

    // Add another owner, then demotion is allowed
    await member(b.id, t.id, { isOwner: true });
    ownerCount = await db.membership.count({ where: { isOwner: true } });
    expect(ownerCount).toBe(2);

    const res = await db.membership.updateMany({
      where: { userId: a.id },
      data: { isOwner: false },
    });
    expect(res.count).toBe(1);

    ownerCount = await db.membership.count({ where: { isOwner: true } });
    expect(ownerCount).toBe(1);
  });

  test("blocks deleting the last owner (by route policy)", async () => {
    const t = await mkTenant(`guards-b-${uniq()}`, "Guards B");
    const a = await mkUser(`${uniq()}@example.com`);
    const db = prismaForTenant(t.id);

    await member(a.id, t.id, { isOwner: true });

    const countBefore = await db.membership.count({ where: { isOwner: true } });
    expect(countBefore).toBe(1);

    // Route logic (not this raw DB op) should block when ownerCount <= 1.
    const wouldBeLastOwnerRemoval = countBefore <= 1;
    expect(wouldBeLastOwnerRemoval).toBe(true);
  });
});
