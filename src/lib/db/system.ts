// src/lib/db/system.ts
// Use this ONLY for pre-tenant work (auth lookup, list tenants, null-tenant audit logs).
// Everywhere else use prismaForTenant(tenantId).
import { prisma } from "@/lib/db/prisma";

export type SystemDb = typeof prisma;
export const systemDb: SystemDb = prisma;