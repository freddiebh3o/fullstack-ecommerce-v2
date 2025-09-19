// src/lib/core/schemas.ts
import { z } from "zod";

/** Reusable SKU rule: 1–64 of A–Z, 0–9, dot, underscore, dash */
const SkuSchema = z
  .string()
  .trim()
  .min(1)
  .max(64)
  .regex(/^[A-Z0-9._-]+$/i, "SKU can only contain letters, numbers, '.', '_' and '-'");

/** Base product fields (used by both create & update) */
const ProductBase = z
  .object({
    sku: SkuSchema,
    name: z.string().trim().min(1).max(200),
    description: z.string().trim().max(2000).optional().nullable(),
    priceInPence: z.number().int().min(0).max(10_000_000),
    currency: z.literal("GBP").optional(), // v1 locked to GBP
    isActive: z.boolean().optional(),
  })
  .strict();

export const ProductCreateSchema = ProductBase;

export const ProductUpdateSchema = ProductBase.partial()
  .extend({
    // OCC requirement
    expectedVersion: z.number().int().positive(),
  })
  .strict()
  .refine((data) => {
    // Must send at least one field besides expectedVersion
    const { expectedVersion, ...rest } = data as Record<string, unknown>;
    return Object.values(rest).some((v) => v !== undefined);
  }, { message: "No changes provided" });

/** Member caps schema reused in create/update */
const MemberCapsSchema = z
  .object({
    isOwner: z.boolean().optional(),
    canManageMembers: z.boolean().optional(),
    canManageProducts: z.boolean().optional(),
    canViewProducts: z.boolean().optional(),
  })
  .strict();

export const MemberCreateSchema = z
  .object({
    email: z.string().trim().email(),
    // Important: call .strict() BEFORE .default()
    caps: MemberCapsSchema.default({}),
  })
  .strict();

export const MemberUpdateCapsSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    caps: MemberCapsSchema.refine(
      (v) => Object.values(v).some((val) => val !== undefined),
      { message: "No changes provided" }
    ),
  })
  .strict();

export const TenantSelectSchema = z.object({
  tenantId: z.string().uuid(),
}).strict();