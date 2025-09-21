// src/lib/tenant/resolveTenantByHost.ts
import { prisma } from "@/lib/db/prisma";
import { normalizeHost } from "@/lib/hosts/normalizeHost";
import { TtlCache } from "@/lib/cache/ttlCache";
import { DomainStatus } from "@prisma/client";
import { logger } from "@/lib/log/log";

type ResolveResult = { tenantId: string; isPrimary: boolean } | null;

const cache = new TtlCache<string, ResolveResult>({ ttlMs: 30_000, maxSize: 500 });

export async function resolveTenantByHost(
  rawHost: string | null | undefined,
  opts: { allowPendingInDev?: boolean } = {}
): Promise<ResolveResult> {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  const allowPending =
    !!opts.allowPendingInDev && process.env.NODE_ENV !== "production";

  // Cache key separates behavior with/without pending
  const cacheKey = `${host}|pending:${allowPending ? "y" : "n"}`;
  const cached = cache.get(cacheKey);
  if (cached !== undefined) return cached;

  // In prod, only VERIFIED; in dev (and when allowed), include any status
  const where =
    allowPending
      ? { host: { equals: host, mode: "insensitive" as const } }
      : { host: { equals: host, mode: "insensitive" as const }, status: DomainStatus.VERIFIED };

  const domain = await prisma.domain.findFirst({
    where,
    select: { tenantId: true, isPrimary: true, status: true },
  });

  let result: ResolveResult = null;
  if (domain) {
    const ok = domain.status === DomainStatus.VERIFIED || allowPending;
    if (ok) {
      result = { tenantId: domain.tenantId, isPrimary: domain.isPrimary };
    }
  }

  cache.set(cacheKey, result);

  // Debug-level breadcrumb without leaking PII
  logger.debug({
    event: "resolve_tenant_by_host",
    host,
    result: result ? { tenantId: result.tenantId, isPrimary: result.isPrimary } : null,
    allowPending,
  });

  return result;
}

export function __clearResolveTenantCache() {
  cache.clear();
}
