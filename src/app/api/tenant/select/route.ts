// src/app/api/tenant/select/route.ts
import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { requireSession } from "@/lib/auth/session";
import { systemDb } from "@/lib/db/system";
import { TENANT_COOKIE } from "@/lib/core/constants";

export async function POST(req: Request) {
  const session = await requireSession();
  const { tenantId } = await req.json().catch(() => ({} as any));

  if (!tenantId) {
    return NextResponse.json({ ok: false, error: "tenantId required" }, { status: 400 });
  }

  // Verify membership
  const membership = await systemDb.membership.findFirst({
    where: { userId: (session.user as any).id, tenantId },
  });
  if (!membership) {
    return NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
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

  return NextResponse.json({ ok: true });
}
