// src/lib/db/tenant-scoped.ts
import { Prisma as PrismaNS } from "@prisma/client"; // runtime namespace for defineExtension
import { prisma } from "@/lib/db/prisma";

// Models that MUST always be scoped by tenantId
export const TENANT_SCOPED_MODELS = [
  "Product",
  "Membership",
  "AuditLog",
] as const;

const TENANT_SCOPED = new Set<string>(TENANT_SCOPED_MODELS);
const ERR_PREFIX = "[TenantGuard]";

// Helper to AND-in tenantId into a where clause (if present)
function withTenant(where: unknown, tenantId: string) {
  const w = where && typeof where === "object" ? (where as Record<string, unknown>) : undefined;
  return w ? { AND: [{ tenantId }, w] } : { tenantId };
}

/**
 * Injects/validates tenant on arbitrary Prisma create/update data while
 * preserving the original static type (T) for the caller.
 */
function injectTenantInData<T>(data: T, tenantId: string): T {
  if (data == null || typeof data !== "object") return data;

  const rec = data as unknown as Record<string, unknown>;

  // If caller provided BOTH tenantId and tenant relation, block (ambiguous).
  if ("tenantId" in rec && "tenant" in rec) {
    throw new Error(`${ERR_PREFIX} Provide either tenantId or tenant relation, not both`);
  }

  // If relation object is provided, validate/normalize it
  if ("tenant" in rec && rec.tenant && typeof rec.tenant === "object") {
    const rel = rec.tenant as Record<string, unknown>;
    const connect = rel.connect as Record<string, unknown> | undefined;

    // Accept { tenant: { connect: { id } } } (or where.id) and ensure it matches our context
    let connectedId: string | undefined;
    if (connect) {
      if (typeof connect.id === "string") connectedId = connect.id;
      const where = connect.where as Record<string, unknown> | undefined;
      if (!connectedId && where && typeof where.id === "string") connectedId = where.id;
    }
    if (connectedId && connectedId !== tenantId) {
      throw new Error(`${ERR_PREFIX} Data tenant.connect.id does not match context`);
    }

    // Normalize: always connect to the bound tenant
    const next = { ...rec, tenant: { connect: { id: tenantId } } } as unknown as T;
    return next;
  }

  // Otherwise enforce/inject tenantId on the flat data
  if (rec.tenantId == null) {
    const next = { ...rec, tenantId } as unknown as T;
    return next;
  }
  if (rec.tenantId !== tenantId) {
    throw new Error(`${ERR_PREFIX} Data tenantId does not match context`);
  }
  return data;
}

function createTenantGuard(tenantId: string) {
  if (!tenantId) throw new Error(`${ERR_PREFIX} tenantId required`);

  return PrismaNS.defineExtension({
    name: "tenant-guard",
    query: {
      $allModels: {
        async $allOperations({ model, operation, args, query }) {
          // Non-tenant models pass through untouched
          if (!model || !TENANT_SCOPED.has(model)) {
            return query(args);
          }

          switch (operation) {
            // Read buckets where we can safely inject tenant filters
            case "findMany":
            case "findFirst":
            case "count":
            case "aggregate":
            case "groupBy":
            case "updateMany":
            case "deleteMany": {
              args.where = withTenant(args.where, tenantId) as typeof args.where;
              return query(args);
            }

            // Create buckets: force/validate tenantId on the data
            case "create": {
              args.data = injectTenantInData(args.data, tenantId) as typeof args.data;
              return query(args);
            }
            case "createMany": {
              if (Array.isArray(args.data)) {
                args.data = (args.data as unknown[]).map((d) =>
                  injectTenantInData(d, tenantId)
                ) as typeof args.data;
              } else {
                args.data = injectTenantInData(args.data, tenantId) as typeof args.data;
              }
              return query(args);
            }

            // Upsert is allowed ONLY when using a composite unique that includes tenantId
            case "upsert": {
              const whereObj = (args.where ?? {}) as Record<string, unknown>;
              const whereKeys = Object.keys(whereObj);
              let includesTenant = false;
              for (const k of whereKeys) {
                const v = whereObj[k] as unknown;
                if (
                  v &&
                  typeof v === "object" &&
                  "tenantId" in (v as Record<string, unknown>) &&
                  (v as Record<string, unknown>).tenantId === tenantId
                ) {
                  includesTenant = true;
                  break;
                }
              }
              if (!includesTenant) {
                throw new Error(
                  `${ERR_PREFIX} upsert on ${model} must use a composite unique that includes tenantId`
                );
              }
              args.create = injectTenantInData(args.create, tenantId) as typeof args.create;
              if (args.update) {
                args.update = injectTenantInData(args.update, tenantId) as typeof args.update;
              }
              return query(args);
            }

            // Unsafe single-record ops without tenant filter — block outright
            case "findUnique":
            case "update":
            case "delete": {
              throw new Error(
                `${ERR_PREFIX} ${operation} on ${model} is disallowed. ` +
                  `Use findFirst/updateMany/deleteMany with tenantId or a composite unique that includes tenantId.`
              );
            }

            default:
              return query(args);
          }
        },
      },
    },
  });
}

/**
 * Factory: returns a PrismaClient extended to be locked to a specific tenantId.
 * All tenant-scoped models are auto-filtered and guarded.
 */
export function prismaForTenant(tenantId: string) {
  return prisma.$extends(createTenantGuard(tenantId));
}
