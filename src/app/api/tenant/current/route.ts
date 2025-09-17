// src/app/api/tenant/current/route.ts
import { getCurrentTenantId } from "@/lib/core/tenant";
import { systemDb } from "@/lib/db/system";
import { requireSession } from "@/lib/auth/session";
import { ok, fail } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";

export const GET = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return fail(400, "No tenant selected", undefined, req);

  // Ensure user still belongs to it (defensive)
  const m = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    include: { tenant: true } as const,
  });
  if (!m) return fail(403, "Forbidden", undefined, req);

  return ok(
    { tenantId: m.tenantId, slug: m.tenant.slug, name: m.tenant.name },
    200,
    req
  );
});
