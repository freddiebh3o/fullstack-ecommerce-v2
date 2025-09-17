// src/app/api/me/tenants/route.ts
import { requireSession } from "@/lib/auth/session";
import { systemDb } from "@/lib/db/system";
import { ok } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";

export const GET = withApi(async (req: Request) => {
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

  return ok(data, 200, req);
});
