import { z } from "zod";

export const ProductCreateInput = z.object({
  sku: z.string().min(1, "SKU is required"),
  name: z.string().min(1, "Name is required"),
  description: z.string().nullable().optional(),
  priceInPence: z.number().int().nonnegative(),
  currency: z.string().length(3).default("GBP").optional(),
  isActive: z.boolean().default(true).optional(),
});

export const ProductUpdateInput = z.object({
  name: z.string().min(1).optional(),
  description: z.string().nullable().optional(),
  priceInPence: z.number().int().nonnegative().optional(),
  currency: z.string().length(3).optional(),
  isActive: z.boolean().optional(),
});

export type ProductCreateInput = z.infer<typeof ProductCreateInput>;
export type ProductUpdateInput = z.infer<typeof ProductUpdateInput>;
