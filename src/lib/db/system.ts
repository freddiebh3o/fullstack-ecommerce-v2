// Use this ONLY for pre-tenant work (auth lookup, list tenants, null-tenant audit logs).
// Everywhere else use prismaForTenant(tenantId).
import type { PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

export const systemDb: PrismaClient = prisma;