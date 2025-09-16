// src/app/api/me/tenants/route.ts
import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { systemDb } from "@/lib/db/system";

export async function GET() {
  const session = await requireSession();
  const memberships = await systemDb.membership.findMany({
    where: { userId: (session.user as any).id },
    include: { tenant: true } as const,
    orderBy: { createdAt: "asc" },
  });

  const data = memberships.map(m => ({
    tenantId: m.tenantId,
    slug: m.tenant.slug,
    name: m.tenant.name,
    caps: {
      isOwner: m.isOwner,
      canManageMembers: m.canManageMembers,
      canManageProducts: m.canManageProducts,
      canViewProducts: m.canViewProducts,
    },
  }));

  return NextResponse.json({ ok: true, data });
}
