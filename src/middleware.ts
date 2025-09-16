// src/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyDoubleSubmit } from "@/lib/security/csrf";
import { verifyOriginStrict } from "@/lib/security/origin";
import { applySecurityHeaders } from "@/lib/security/headers";

const SKIP_CSRF_FOR_PATHS = ["/api/security/csrf"];
const SKIP_ALL_FOR_PREFIXES = ["/api/auth/"];

function shouldSkipAll(pathname: string) {
  return SKIP_ALL_FOR_PREFIXES.some((p) => pathname.startsWith(p));
}
function shouldSkipCsrf(pathname: string) {
  return SKIP_CSRF_FOR_PATHS.includes(pathname);
}

export function middleware(req: NextRequest) {
  const { pathname } = req.nextUrl;
  const method = req.method.toUpperCase();

  const isApi = pathname.startsWith("/api/");
  const pass = NextResponse.next();

  // Always attach headers
  applySecurityHeaders(req, pass);

  if (!isApi) return pass;
  if (shouldSkipAll(pathname)) return pass;

  const isUnsafe = !["GET", "HEAD", "OPTIONS"].includes(method);
  if (!isUnsafe) return pass;

  // 1) Require Origin
  const originCheck = verifyOriginStrict(req);
  if (!originCheck.ok) {
    const deny = NextResponse.json({ ok: false, error: originCheck.error ?? "Forbidden" }, { status: 403 });
    applySecurityHeaders(req, deny);
    return deny;
  }

  // 2) CSRF (skip token endpoint)
  if (!shouldSkipCsrf(pathname)) {
    const csrfCheck = verifyDoubleSubmit(req);
    if (!csrfCheck.ok) {
      const deny = NextResponse.json({ ok: false, error: csrfCheck.error ?? "CSRF failed" }, { status: 403 });
      applySecurityHeaders(req, deny);
      return deny;
    }
  }

  return pass;
}

export const config = { matcher: ["/api/:path*"] };
