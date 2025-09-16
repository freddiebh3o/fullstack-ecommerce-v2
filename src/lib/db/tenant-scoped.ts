// src/lib/db/tenant-scoped.ts
import { Prisma, PrismaClient } from "@prisma/client";
import { prisma } from "./prisma";

// Models that MUST always be scoped by tenantId
export const TENANT_SCOPED_MODELS = [
  "Product",
  "Membership",
  "AuditLog",
] as const;

const TENANT_SCOPED = new Set<string>(TENANT_SCOPED_MODELS);
const ERR_PREFIX = "[TenantGuard]";

// Helper to AND-in tenantId into any where clause
function withTenant(where: any, tenantId: string) {
  return where ? { AND: [{ tenantId }, where] } : { tenantId };
}

function injectTenantInData(data: any, tenantId: string) {
  if (data == null || typeof data !== "object") return data;

  // If caller provided BOTH tenantId and tenant relation, block (ambiguous).
  if ("tenantId" in data && "tenant" in data) {
    throw new Error(`${ERR_PREFIX} Provide either tenantId or tenant relation, not both`);
  }

  // If relation object is provided, validate/normalize it
  if ("tenant" in data && data.tenant && typeof data.tenant === "object") {
    const rel = data.tenant;
    // Accept { tenant: { connect: { id } } } and ensure it matches our context
    const connectedId = rel.connect?.id ?? rel.connect?.where?.id;
    if (connectedId && connectedId !== tenantId) {
      throw new Error(`${ERR_PREFIX} Data tenant.connect.id does not match context`);
    }
    // Normalize: always connect to the bound tenant
    return { ...data, tenant: { connect: { id: tenantId } } };
  }

  // Otherwise enforce/inject tenantId on the flat data
  if (data.tenantId == null) return { ...data, tenantId };
  if (data.tenantId !== tenantId) {
    throw new Error(`${ERR_PREFIX} Data tenantId does not match context`);
  }
  return data;
}

function createTenantGuard(tenantId: string) {
  if (!tenantId) throw new Error(`${ERR_PREFIX} tenantId required`);

  return Prisma.defineExtension({
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
              args.where = withTenant(args.where, tenantId);
              return query(args);
            }

            // Create buckets: force/validate tenantId on the data
            case "create": {
              args.data = injectTenantInData(args.data, tenantId);
              return query(args);
            }
            case "createMany": {
              if (Array.isArray(args.data)) {
                args.data = args.data.map((d: any) => injectTenantInData(d, tenantId));
              } else {
                args.data = injectTenantInData(args.data, tenantId);
              }
              return query(args);
            }

            // Upsert is allowed ONLY when using a composite unique that includes tenantId
            case "upsert": {
              const whereObj = args.where ?? {};
              const whereKeys = Object.keys(whereObj);
              let includesTenant = false;
              for (const k of whereKeys) {
                const v = (whereObj as any)[k];
                if (v && typeof v === "object" && "tenantId" in v && v.tenantId === tenantId) {
                  includesTenant = true;
                  break;
                }
              }
              if (!includesTenant) {
                throw new Error(
                  `${ERR_PREFIX} upsert on ${model} must use a composite unique that includes tenantId`
                );
              }
              args.create = injectTenantInData(args.create, tenantId);
              if (args.update) args.update = injectTenantInData(args.update, tenantId);
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