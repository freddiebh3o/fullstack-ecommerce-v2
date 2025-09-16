import { NextResponse } from "next/server";
import { z } from "zod";
import { requireSession } from "@/lib/auth/session";
import { requireCurrentTenantId } from "@/lib/core/tenant";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { systemDb } from "@/lib/db/system";

// input: at least one cap must be present
const UpdateCapsInput = z.object({
  caps: z.object({
    isOwner: z.boolean().optional(),
    canManageMembers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canViewProducts: z.boolean().optional(),
  }).refine(v => Object.keys(v).length > 0, { message: "No changes provided" }),
});

export async function PATCH(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;
  const session = await requireSession();
  const tenantId = await requireCurrentTenantId();

  // Caller must manage members; only owners can modify isOwner
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const body = await req.json().catch(() => null);
  const parsed = UpdateCapsInput.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json(
      { ok: false, error: "Invalid input", issues: parsed.error.flatten() },
      { status: 422 }
    );
  }
  const caps = parsed.data.caps;

  if ("isOwner" in caps && caps.isOwner !== undefined && !me.isOwner) {
    return NextResponse.json(
      { ok: false, error: "Only owners can modify isOwner" },
      { status: 403 }
    );
  }

  const db = prismaForTenant(tenantId);

  // Ensure target exists in THIS tenant
  const target = await db.membership.findFirst({
    where: { id },
    select: { id: true, userId: true, isOwner: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Last-owner guard: cannot demote the final owner
  if (target.isOwner && caps.isOwner === false) {
    const ownerCount = await db.membership.count({ where: { isOwner: true } });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { ok: false, error: "Cannot remove the last owner" },
        { status: 409 }
      );
    }
  }

  // Perform update (tenant guard ensures scoping)
  const res = await db.membership.updateMany({ where: { id }, data: caps });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  const updated = await db.membership.findFirst({
    where: { id },
    include: { user: { select: { id: true, email: true, name: true } } },
  });

  const data = {
    membershipId: updated!.id,
    userId: updated!.userId,
    user: updated!.user,
    caps: {
      isOwner: updated!.isOwner,
      canManageMembers: updated!.canManageMembers,
      canManageProducts: updated!.canManageProducts,
      canViewProducts: updated!.canViewProducts,
    },
    updatedAt: updated!.createdAt, // createdAt is what we stored; no updatedAt on membership in v1
  };

  return NextResponse.json({ ok: true, data });
}

export async function DELETE(req: Request, ctx: { params: Promise<{ id: string }> }) {
  const { id } = await ctx.params;

  const session = await requireSession();

  // Graceful 400 if tenant is missing (instead of throwing 500)
  let tenantId: string;
  try {
    tenantId = await requireCurrentTenantId();
  } catch {
    return NextResponse.json({ ok: false, error: "No tenant selected" }, { status: 400 });
  }

  // Capability: must manage members
  const me = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    select: { isOwner: true, canManageMembers: true },
  });
  if (!me || !me.canManageMembers) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
  }

  const db = prismaForTenant(tenantId);

  // Ensure target exists in THIS tenant (tenant guard scopes this)
  const target = await db.membership.findFirst({
    where: { id },
    select: { id: true, userId: true, isOwner: true },
  });
  if (!target) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // Owners can remove owners; non-owners cannot
  if (target.isOwner && !me.isOwner) {
    return NextResponse.json(
      { ok: false, error: "Only owners can remove owners" },
      { status: 403 }
    );
  }

  // Last-owner guard
  if (target.isOwner) {
    const ownerCount = await db.membership.count({ where: { isOwner: true } });
    if (ownerCount <= 1) {
      return NextResponse.json(
        { ok: false, error: "Cannot remove the last owner" },
        { status: 409 }
      );
    }
  }

  // Perform deletion safely
  const res = await db.membership.deleteMany({ where: { id } });
  if (res.count !== 1) {
    return NextResponse.json({ ok: false, error: "Not found" }, { status: 404 });
  }

  // (Optional) TODO: write an auditLog entry here

  return NextResponse.json({ ok: true });
}

export async function PUT() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}

export async function POST() {
  return NextResponse.json({ ok: false, error: "Method Not Allowed" }, { status: 405 });
}
