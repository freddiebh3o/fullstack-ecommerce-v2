import type { prismaForTenant } from "./tenant-scoped";

export type TenantClient = ReturnType<typeof prismaForTenant>;