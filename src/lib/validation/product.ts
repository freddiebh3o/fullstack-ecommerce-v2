// src/lib/validation/product.ts
import { z } from "zod";

export const ProductCreateInput = z.object({
  sku: z.string().min(1, "SKU is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  priceInPence: z.number().int().nonnegative(),
  currency: z.string().length(3).default("GBP").optional(),
  isActive: z.boolean().default(true).optional(),
});

export const ProductUpdateInput = z
  .object({
    expectedVersion: z.number().int().positive(),

    name: z.string().trim().min(1).max(200).optional(),
    description: z.string().trim().max(1000).nullable().optional(),
    priceInPence: z.number().int().min(0).optional(),
    // Keep len(3) string for now; we can tighten to enum in Phase 9 if you like
    currency: z.string().trim().length(3).toUpperCase().optional(),
    isActive: z.boolean().optional(),
  })
  .refine((data) => {
    const { expectedVersion, ...rest } = data as Record<string, unknown>;
    // At least one field besides expectedVersion must be provided
    return Object.values(rest).some((v) => v !== undefined);
  }, { message: "No changes provided" });

export type ProductCreateInput = z.infer<typeof ProductCreateInput>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateInput>;
