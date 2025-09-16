// src/app/api/admin/members/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { z } from "zod";

const CreateMemberInput = z.object({
  email: z.string().email(),
  caps: z
    .object({
    isOwner: z.boolean().optional(),
    canManageMembers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canViewProducts: z.boolean().optional(),
    })
    .optional(),
});

export async function GET() {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);
  const memberships = await db.membership.findMany({
    orderBy: { createdAt: "asc" },
    include: {
      user: { select: { id: true, email: true, name: true } },
    },
  });

  const data = memberships.map(m => ({
    membershipId: m.id,
    userId: m.userId,
    user: {
      id: m.user.id,
      email: m.user.email,
      name: m.user.name,
    },
    caps: {
      isOwner: m.isOwner,
      canManageMembers: m.canManageMembers,
      canManageProducts: m.canManageProducts,
      canViewProducts: m.canViewProducts,
    },
    createdAt: m.createdAt,
  }));

  return NextResponse.json({ ok: true, data });
}

export async function POST(req: Request) {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Caller must be able to manage members
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = CreateMemberInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }

  const email = parsed.data.email.toLowerCase().trim();
  const reqCaps = parsed.data.caps ?? {};

  // Only owners may grant isOwner at creation
  if (reqCaps.isOwner === true && !me.isOwner) {
    return NextResponse.json(
      { ok: false, error: "Only owners can grant isOwner" },
      { status: 403 }
    );
  }

  // Must be an existing user (no public signup in v1)
  const user = await systemDb.user.findUnique({
    where: { email },
    select: { id: true, email: true, name: true },
  });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

  // No duplicates
  const exists = await systemDb.membership.findFirst({
    where: { userId: user.id, tenantId },
    select: { id: true },
  });
  if (exists) {
    return NextResponse.json({ ok: false, error: "Already a member" }, { status: 409 });
  }

  // Defaults for caps (sensible v1 baseline)
  const caps = {
    isOwner: false,
    canManageMembers: false,
    canManageProducts: false,
    canViewProducts: true,
    ...reqCaps,
  };

  // Create membership in tenant scope
  const db = prismaForTenant(tenantId);
  const created = await db.membership.create({
    data: {
      // Satisfy Prisma types explicitly with relations:
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

  return NextResponse.json({ ok: true, data }, { status: 201 });
}

// Optional: method guard so POST-only endpoints don’t silently accept others
export async function PUT() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
