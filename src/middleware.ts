// src/middleware.ts
// src/middleware.ts
import type { NextRequest } from "next/server";
import { NextResponse } from "next/server";
import { verifyDoubleSubmit } from "@/lib/security/csrf";
import { verifyOriginStrict } from "@/lib/security/origin";
import { applySecurityHeaders } from "@/lib/security/headers";
import { logger } from "@/lib/log/log";
import { ipFromRequest, rateLimitFixedWindow } from "./lib/security/rate-limit";

const SKIP_CSRF_FOR_PATHS = ["/api/security/csrf"];
const SKIP_ALL_FOR_PREFIXES = ["/api/auth/"];

function shouldSkipAll(pathname: string) {
  return SKIP_ALL_FOR_PREFIXES.some((p) => pathname.startsWith(p));
}
function shouldSkipCsrf(pathname: string) {
  return SKIP_CSRF_FOR_PATHS.includes(pathname);
}

// ✅ new: uniform deny response that sets both header + body requestId
function denyJson(
  req: NextRequest,
  requestId: string,
  status: number,
  error: string
) {
  const res = NextResponse.json({ ok: false, error, requestId }, { status });
  res.headers.set("x-request-id", requestId);
  applySecurityHeaders(req, res);
  return res;
}

export function middleware(req: NextRequest) {
  const existingId = req.headers.get("x-request-id") || req.headers.get("x-correlation-id");
  const requestId =
    existingId ||
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2));

  const { pathname } = req.nextUrl;

  if (pathname.startsWith("/api/auth/")) {
    const ip = ipFromRequest(req);
    const stats = rateLimitFixedWindow({
      key: `auth:ip:${ip}`,
      limit: Number(process.env.RL_AUTH_PER_IP_PER_MIN || 10), // default 10/min
      windowMs: 60_000,
    });
  
    if (!stats.ok) {
      logger.warn({ event: "rate_limited", requestId, path: pathname, ip, scope: "auth:ip", ...stats });
      const res = denyJson(req, requestId, 429, "Too Many Requests");
      res.headers.set("Retry-After", String(stats.retryAfter ?? 60));
      res.headers.set("X-RateLimit-Limit", String(stats.limit));
      res.headers.set("X-RateLimit-Remaining", String(stats.remaining));
      return res;
    }
  }

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
      return denyJson(req, requestId, 403, originCheck.error ?? "Invalid Origin");
    }
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
      return denyJson(req, requestId, 403, csrfCheck.error ?? "CSRF failed");
    }
  }

  const pass = NextResponse.next();
  pass.headers.set("x-request-id", requestId);
  applySecurityHeaders(req, pass);
  return pass;
}

export const config = { matcher: ["/api/:path*"] };
