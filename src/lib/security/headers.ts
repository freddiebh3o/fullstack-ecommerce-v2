import { NextRequest, NextResponse } from "next/server";

export function applySecurityHeaders(_req: NextRequest, res: NextResponse) {
  const isProd = process.env.NODE_ENV === "production";

  // Baselines
  res.headers.set("X-Frame-Options", "DENY");
  res.headers.set("X-Content-Type-Options", "nosniff");
  res.headers.set("Referrer-Policy", "strict-origin-when-cross-origin");
  res.headers.set("Permissions-Policy",
    "geolocation=(), microphone=(), camera=(), payment=(), midi=(), usb=()"
  );

  // HSTS (only when behind HTTPS)
  if (isProd) {
    res.headers.set("Strict-Transport-Security", "max-age=63072000; includeSubDomains; preload");
  }

  // Minimal CSP (you can refine later). Keep relaxed in dev to avoid fighting with Vite/Next dev scripts.
  const csp = [
    "default-src 'self'",
    "frame-ancestors 'none'",
    "img-src 'self' data: blob:",
    `connect-src 'self'${isProd ? "" : " ws://localhost:3000 http://localhost:3000"}`,
    "script-src 'self' 'unsafe-inline'", // later: move to nonce-based + 'strict-dynamic'
    "style-src 'self' 'unsafe-inline'",
    "font-src 'self' data:",
    "base-uri 'self'"
  ].join("; ");
  res.headers.set("Content-Security-Policy", csp);
}
