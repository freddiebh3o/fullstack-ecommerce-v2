// src/lib/security/csrf.ts
import { NextRequest, NextResponse } from "next/server";

const CSRF_COOKIE_NAME = process.env.CSRF_COOKIE_NAME ?? "csrf_token";
const CSRF_HEADER_NAME = (process.env.CSRF_HEADER_NAME ?? "x-csrf-token").toLowerCase();

// Web-crypto token (Edge/Node compatible)
function randomHex(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let out = "";
  for (let i = 0; i < buf.length; i++) {
    const h = buf[i].toString(16).padStart(2, "0");
    out += h;
  }
  return out; // 64 hex chars for 32 bytes
}

export function generateCsrfToken(): string {
  return randomHex(32);
}

// constant-time string compare (Edge-safe)
export function timingSafeEqual(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

export function setCsrfCookie(res: NextResponse, token: string) {
  res.cookies.set(CSRF_COOKIE_NAME, token, {
    httpOnly: false,              // double-submit needs readable cookie
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60,              // 1 hour
  });
}

export function getCsrfCookieFromRequest(req: NextRequest): string | null {
  return req.cookies.get(CSRF_COOKIE_NAME)?.value ?? null;
}

export function getCsrfHeaderFromRequest(req: NextRequest): string | null {
  const h = req.headers.get(CSRF_HEADER_NAME);
  return h && h.trim().length ? h : null;
}

/** Verifies double-submit */
export function verifyDoubleSubmit(req: NextRequest): { ok: boolean; error?: string } {
  const cookieToken = getCsrfCookieFromRequest(req);
  const headerToken = getCsrfHeaderFromRequest(req);

  if (!cookieToken || !headerToken) {
    return { ok: false, error: "CSRF token missing" };
  }
  if (!timingSafeEqual(cookieToken, headerToken)) {
    return { ok: false, error: "CSRF token mismatch" };
  }
  return { ok: true };
}

/** Issue token JSON + set cookie (used by /api/security/csrf) */
export async function issueCsrfTokenResponse(): Promise<NextResponse> {
  const token = generateCsrfToken();
  const res = NextResponse.json({ ok: true, csrfToken: token });
  setCsrfCookie(res, token);
  return res;
}
