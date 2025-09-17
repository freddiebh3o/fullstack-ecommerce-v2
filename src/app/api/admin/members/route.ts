// src/app/api/admin/members/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";
import { z } from "zod";
import { writeAudit } from "@/lib/core/audit";
import { withApi } from "@/lib/utils/with-api";

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

  return NextResponse.json({
    ok: true,
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
  });
});

export const POST = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Caller must manage members
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
  const { email, caps } = parsed.data;

  // target user must exist
  const user = await systemDb.user.findUnique({ where: { email } });
  if (!user) {
    return NextResponse.json({ ok: false, error: "User not found" }, { status: 404 });
  }

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

  // Audit: membership created
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

  return NextResponse.json({ ok: true, data }, { status: 201 });
});

// Optional: method guard so POST-only endpoints don’t silently accept others
export async function PUT() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
