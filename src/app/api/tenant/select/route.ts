// src/app/api/tenant/select/route.ts
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { systemDb } from "@/lib/db/system";
import { TENANT_COOKIE } from "@/lib/core/constants";
import { ok, fail } from "@/lib/utils/http";
import { withApi } from "@/lib/utils/with-api";
import { TenantSelectSchema } from "@/lib/core/schemas";

export const POST = withApi(async (req: Request) => {
  const session = await requireSession();
  const body = await req.json().catch(() => null);
  const parsed = TenantSelectSchema.safeParse(body);
  if (!parsed.success) {
    return fail(422, "Invalid input", { issues: parsed.error.flatten() }, req);
  }
  const { tenantId } = parsed.data;

  // Verify membership
  const membership = await systemDb.membership.findFirst({
    where: { userId: session.user.id, tenantId },
  });
  if (!membership) {
    return fail(403, "Forbidden", undefined, req);
  }

  // Set secure cookie
  const jar = await cookies();
  jar.set(TENANT_COOKIE, tenantId, {
    httpOnly: true,
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  });

  return ok({ selected: true }, 200, req);
});
