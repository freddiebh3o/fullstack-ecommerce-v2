import { withPublic } from "@/lib/utils/with-public";
import { ok } from "@/lib/utils/http";
import { getTenantId } from "@/lib/tenant/context";

export const GET = withPublic(async (req: Request) => {
  // If we got here, a tenant was resolved by host.
  const tenantId = getTenantId();
  return ok({ ok: true, tenantId }, 200, req);
});
