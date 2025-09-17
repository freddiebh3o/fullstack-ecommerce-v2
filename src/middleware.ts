// src/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyDoubleSubmit } from "@/lib/security/csrf";
import { verifyOriginStrict } from "@/lib/security/origin";
import { applySecurityHeaders } from "@/lib/security/headers";
import { logger } from "@/lib/log";

const SKIP_CSRF_FOR_PATHS = ["/api/security/csrf"];
const SKIP_ALL_FOR_PREFIXES = ["/api/auth/"];

function shouldSkipAll(pathname: string) {
  return SKIP_ALL_FOR_PREFIXES.some((p) => pathname.startsWith(p));
}
function shouldSkipCsrf(pathname: string) {
  return SKIP_CSRF_FOR_PATHS.includes(pathname);
}

export function middleware(req: NextRequest) {
  // Correlate every request with a request id
  const existingId = req.headers.get("x-request-id") || req.headers.get("x-correlation-id");
  const requestId =
    existingId ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2));

  const { pathname } = req.nextUrl;

  if (shouldSkipAll(pathname)) {
    const pass = NextResponse.next();
    pass.headers.set("x-request-id", requestId);
    applySecurityHeaders(req, pass);
    return pass;
  }

  // 1) Strict Origin for non-GET
  if (req.method !== "GET") {
    const originCheck = verifyOriginStrict(req);
    if (!originCheck.ok) {
      logger.warn({
        event: "origin_denied",
        requestId,
        method: req.method,
        path: pathname,
        origin: req.headers.get("origin"),
        referer: req.headers.get("referer"),
      });
      const deny = NextResponse.json({ ok: false, error: originCheck.error ?? "Invalid Origin" }, { status: 403 });
      applySecurityHeaders(req, deny);
      deny.headers.set("x-request-id", requestId);
      return deny;
1    }
  }

  // 2) CSRF (skip token endpoint)
  if (!shouldSkipCsrf(pathname)) {
    const csrfCheck = verifyDoubleSubmit(req);
    if (!csrfCheck.ok) {
      logger.warn({
        event: "csrf_denied",
        requestId,
        method: req.method,
        path: pathname,
        hasCookie: Boolean(req.cookies.get("csrf")),
        hasHeader: Boolean(req.headers.get("x-csrf-token")),
      });
      const deny = NextResponse.json({ ok: false, error: csrfCheck.error ?? "CSRF failed" }, { status: 403 });
      applySecurityHeaders(req, deny);
      deny.headers.set("x-request-id", requestId);
      return deny;
    }
  }

  const pass = NextResponse.next();
  pass.headers.set("x-request-id", requestId);
  applySecurityHeaders(req, pass);
  return pass;
}

export const config = { matcher: ["/api/:path*"] };
