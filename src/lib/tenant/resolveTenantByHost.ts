// src/lib/tenant/resolveTenantByHost.ts
import { prisma } from "@/lib/db/prisma";
import { normalizeHost } from "@/lib/hosts/normalizeHost";
import { TtlCache } from "@/lib/cache/ttlCache";
import { DomainStatus } from "@prisma/client";

type ResolveResult = { tenantId: string; isPrimary: boolean } | null;

const cache = new TtlCache<string, ResolveResult>({ ttlMs: 30_000, maxSize: 500 });

export async function resolveTenantByHost(
  rawHost: string | null | undefined,
  opts?: { allowPendingInDev?: boolean }
): Promise<ResolveResult> {
  const host = normalizeHost(rawHost);
  if (!host) return null;

  const cached = cache.get(host);
  if (cached !== undefined) return cached;

  // ✅ case-insensitive, defensive
  const domain = await prisma.domain.findFirst({
    where: { host: { equals: host, mode: "insensitive" } },
    select: { tenantId: true, isPrimary: true, status: true },
  });

  console.debug("[resolveTenantByHost] host", host, "domain", domain);

  let result: ResolveResult = null;
  if (domain) {
    const isVerified = domain.status === DomainStatus.VERIFIED;
    const allowPending =
      !!opts?.allowPendingInDev && process.env.NODE_ENV !== "production";
    if (isVerified || allowPending) {
      result = { tenantId: domain.tenantId, isPrimary: domain.isPrimary };
    }
  }

  cache.set(host, result);
  return result;
}

export function __clearResolveTenantCache() {
  cache.clear();
}
