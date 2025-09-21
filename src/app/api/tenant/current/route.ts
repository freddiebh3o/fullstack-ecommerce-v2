// src/app/api/tenant/current/route.ts
import { getTenantId } from "@/lib/tenant/context";
import { systemDb } from "@/lib/db/system";
import { requireSession } from "@/lib/auth/session";
import { ok, fail } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";

export const GET = withApi(async (req: Request) => {
  const session = await requireSession();
  const tenantId = getTenantId();
  if (!tenantId) return fail(403, "Tenant not resolved", undefined, req);

  // Ensure user still belongs to it (defensive)
  const m = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
    include: { tenant: true } as const,
  });
  if (!m) return fail(403, "Forbidden", undefined, req);

  return ok(
    { tenantId: m.tenantId, slug: m.tenant.slug, name: m.tenant.name },
    200,
    req
  );
});
