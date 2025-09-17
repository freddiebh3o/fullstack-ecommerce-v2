import { z } from "zod";

export const ProductCreateSchema = z.object({
  sku: z.string().min(1).max(64),
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional().nullable(),
  priceInPence: z.number().int().min(0).max(10_000_000),
  currency: z.literal("GBP").optional(),        // locked to GBP in v1
  isActive: z.boolean().optional(),
});

export const ProductUpdateSchema = ProductCreateSchema.partial()
  .refine(obj => Object.keys(obj).length > 0, { message: "No changes provided" });

export const MemberCreateSchema = z.object({
  email: z.string().email(),
  caps: z.object({
    isOwner: z.boolean().optional(),
    canManageMembers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canViewProducts: z.boolean().optional(),
  }).default({ canViewProducts: true }),
});

export const MemberUpdateCapsSchema = z.object({
  caps: z.object({
    isOwner: z.boolean().optional(),
    canManageMembers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canViewProducts: z.boolean().optional(),
  }).refine(v => Object.keys(v).length > 0, { message: "No changes provided" }),
});
