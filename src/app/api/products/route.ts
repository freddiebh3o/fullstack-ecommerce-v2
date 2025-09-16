import { NextResponse } from "next/server";
import { requireSession } from "@/lib/auth/session";
import { dbForCurrentTenantOrThrow } from "@/lib/core/tenant";

export async function GET() {
  // auth required
  await requireSession();

  // tenant-bound prisma client
  const db = await dbForCurrentTenantOrThrow();

  const products = await db.product.findMany({
    orderBy: { createdAt: "asc" },
    select: { id: true, sku: true, name: true, priceInCents: true, currency: true, isActive: true },
  });

  return NextResponse.json({ ok: true, data: products });
}
