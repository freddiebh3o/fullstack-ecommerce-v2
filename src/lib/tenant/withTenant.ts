// src/lib/tenant/withTenant.ts
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { normalizeHost } from "@/lib/hosts/normalizeHost";
import { resolveTenantByHost } from "@/lib/tenant/resolveTenantByHost";
import { runWithTenantContext } from "@/lib/tenant/context";
import { TENANT_COOKIE, tenantCookieAttributes } from "@/lib/core/constants";
import { logger } from "@/lib/log/log";

type WithTenantOpts = {
  allowCookieFallbackForAdmin?: boolean;
  allowPendingInDev?: boolean;
};

// tiny cookie parser for plain Request cases
function readCookie(headerVal: string | null, name: string): string | undefined {
  if (!headerVal) return;
  const parts = headerVal.split(/;\s*/);
  for (const p of parts) {
    const [k, ...rest] = p.split("=");
    if (k === name) return rest.join("="); // don’t decode; we only store a UUID
  }
}

function hostFrom(h: Headers): string | null {
  const xfh = normalizeHost(h.get("x-forwarded-host"));
  if (xfh) return xfh;
  const host = normalizeHost(h.get("host"));
  return host;
}

export async function withTenant<T>(
  handler: () => Promise<T>,
  opts: WithTenantOpts = {},
  req?: Request
): Promise<T> {
  // prefer request-scoped primitives when provided
  const h = req ? req.headers : await nextHeaders();
  const cookieHeader = req ? req.headers.get("cookie") : null;
  const jar = req ? null : await nextCookies(); // ← only available without raw Request

  // 1) Host-based resolution
  const host = hostFrom(h);
  const resolved = await resolveTenantByHost(host, { allowPendingInDev: opts.allowPendingInDev });

  // 2) Cookie fallback
  const cookieTid = req ? readCookie(cookieHeader, TENANT_COOKIE) : jar?.get(TENANT_COOKIE)?.value;

  let tenantId: string | undefined;
  let source: "host" | "cookie" | "header" | "query" | null = null;

  if (resolved?.tenantId) {
    tenantId = resolved.tenantId;
    source = "host";

    // Non-destructive sync: write only when we have Next cookies() and value differs
    if (!req && jar && (!cookieTid || cookieTid !== tenantId)) {
      const from = cookieTid ?? null;
      jar.set(TENANT_COOKIE, tenantId, tenantCookieAttributes());
      logger.info({
        event: "tenant_cookie_synced",
        reason: "host_resolution",
        from,
        to: tenantId,
      });
    }
  } else if (opts.allowCookieFallbackForAdmin && cookieTid) {
    tenantId = cookieTid;
    source = "cookie";
  }

  // 3) Dev-only fallbacks
  if (!tenantId && process.env.NODE_ENV !== "production") {
    const hTid = h.get("x-test-tenant-id") ?? h.get("x-tenant-id") ?? undefined;
    if (hTid && hTid.trim()) {
      tenantId = hTid.trim();
      source = "header";
    }
    if (!tenantId) {
      const fullUrl =
        (req ? req.url : null) || h.get("next-url") || h.get("x-url") || undefined;
      if (fullUrl) {
        try {
          const u = new URL(fullUrl);
          const qpTid = u.searchParams.get("__tenant");
          if (qpTid) {
            tenantId = qpTid;
            source = "query";
          }
        } catch { /* ignore */ }
      }
    }

    // Non-destructive sync in dev too (only with Next cookies())
    if (!req && jar && tenantId && source !== "cookie") {
      const current = jar.get(TENANT_COOKIE)?.value ?? null;
      if (current !== tenantId) {
        jar.set(TENANT_COOKIE, tenantId, tenantCookieAttributes());
        logger.info({
          event: "tenant_cookie_synced",
          reason: source,        // "header" | "query"
          from: current,
          to: tenantId,
          env: "dev",
        });
      }
    }
  }

  return await runWithTenantContext({ tenantId, source }, handler);
}
