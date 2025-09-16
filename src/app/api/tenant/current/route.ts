// src/app/api/tenant/current/route.ts
import { NextResponse } from "next/server";
import { getCurrentTenantId } from "@/lib/core/tenant";
import { systemDb } from "@/lib/db/system";
import { requireSession } from "@/lib/auth/session";

export async function GET() {
  const session = await requireSession();
  const tenantId = await getCurrentTenantId();
  if (!tenantId) return NextResponse.json({ ok: false, error: "No tenant selected" }, { status: 400 });

  // Ensure user still belongs to it (defensive)
  const m = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
    include: { tenant: true } as const,
  });
  if (!m) return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });

  return NextResponse.json({
    ok: true,
    data: { tenantId: m.tenantId, slug: m.tenant.slug, name: m.tenant.name },
  });
}
