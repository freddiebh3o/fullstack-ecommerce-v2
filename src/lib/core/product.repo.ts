// src/lib/core/product.repo.ts
import type { Prisma } from "@prisma/client";
import type { TenantClient } from "@/lib/db/tenant-types";
import { assertOne, NotFoundError } from "./repo-utils";

export type ProductCreateData = {
  sku: string;
  name: string;
  description?: string | null;
  priceInPence: number;
  currency?: string;
  isActive?: boolean;
};

export function byId(db: TenantClient, id: string) {
  return db.product.findFirst({ where: { id } });
}

export async function requireById(db: TenantClient, id: string) {
  const p = await byId(db, id);
  if (!p) throw new NotFoundError("Product not found");
  return p;
}

// ✅ Compile-time safe: we add the required relation here.
export function create(
  db: TenantClient,
  tenantId: string,
  data: ProductCreateData
) {
  return db.product.create({
    data: {
      ...data,
      tenant: { connect: { id: tenantId } },
    },
  });
}

export async function updateById(
  db: TenantClient,
  id: string,
  data: Prisma.ProductUpdateInput
) {
  const res = await db.product.updateMany({ where: { id }, data });
  assertOne(res, "Product not updated");
}

export async function deleteById(db: TenantClient, id: string) {
  const res = await db.product.deleteMany({ where: { id } });
  assertOne(res, "Product not deleted");
}
