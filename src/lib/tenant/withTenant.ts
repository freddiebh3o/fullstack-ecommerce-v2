// src/lib/tenant/withTenant.ts
import { cookies as nextCookies, headers as nextHeaders } from "next/headers";
import { normalizeHost } from "@/lib/hosts/normalizeHost";
import { resolveTenantByHost } from "@/lib/tenant/resolveTenantByHost";
import { runWithTenantContext } from "@/lib/tenant/context";

const TENANT_COOKIE = "tenant_id";
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

// derive host from given Headers
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
  const c = req ? null : await nextCookies();

  // 1) Primary: host-based (use req headers if we have them)
  const host = hostFrom(h);
  const resolved = await resolveTenantByHost(host, { allowPendingInDev: opts.allowPendingInDev });

  // 2) Cookie fallback (admin flows)
  const cookieTid = req ? readCookie(cookieHeader, TENANT_COOKIE) : c?.get(TENANT_COOKIE)?.value;

  let tenantId: string | undefined;
  let source: "host" | "cookie" | "header" | "query" | null = null;

  if (resolved?.tenantId) {
    tenantId = resolved.tenantId;
    source = "host";

    // keep cookie in sync when we can (Next response-bound cookies only)
    if (!req && c && (!cookieTid || cookieTid !== tenantId)) {
      c.set(TENANT_COOKIE, tenantId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }
  } else if (opts.allowCookieFallbackForAdmin && cookieTid) {
    tenantId = cookieTid;
    source = "cookie";
  }

  // 3) Test/dev-only fallbacks
  if (!tenantId && process.env.NODE_ENV !== "production") {
    // A) Header override
    const hTid = h.get("x-test-tenant-id") ?? h.get("x-tenant-id") ?? undefined;
    if (hTid && hTid.trim()) {
      tenantId = hTid.trim();
      source = "header";
    }

    // B) Query param override (prefer req.url when available)
    if (!tenantId) {
      const fullUrl =
        (req ? req.url : null) ||
        h.get("next-url") ||
        h.get("x-url") ||
        undefined;
      if (fullUrl) {
        try {
          const u = new URL(fullUrl);
          const qpTid = u.searchParams.get("__tenant");
          if (qpTid) {
            tenantId = qpTid;
            source = "query";
          }
        } catch {
          /* ignore */
        }
      }
    }

    // keep cookie in sync in dev if we can (skip for plain Request)
    if (!req && tenantId && source !== "cookie" && c) {
      c.set(TENANT_COOKIE, tenantId, {
        httpOnly: true,
        sameSite: "lax",
        secure: true,
        path: "/",
      });
    }
  }

  return await runWithTenantContext({ tenantId, source }, handler);
}
