// src/lib/security/origin.ts
import { NextRequest } from "next/server";

const APP_URL = process.env.APP_URL ?? "http://localhost:3000";
const ALLOWED = (process.env.ALLOWED_ORIGINS ?? APP_URL)
  .split(",")
  .map(s => s.trim())
  .filter(Boolean);

function originOf(urlLike: string): string | null {
  try {
    const u = new URL(urlLike); // global URL (Edge-safe)
    return `${u.protocol}//${u.host}`;
  } catch {
    return null;
  }
}

/** Strict Origin check: for non-GET, an Origin header MUST be present and allowed. */
export function verifyOriginStrict(req: NextRequest): { ok: boolean; error?: string } {
  const method = req.method.toUpperCase();
  if (method === "GET" || method === "HEAD" || method === "OPTIONS") {
    return { ok: true };
  }

  const origin = req.headers.get("origin");
  if (!origin) return { ok: false, error: "Missing origin" };

  const o = originOf(origin);
  const allowed = new Set(ALLOWED);
  if (o && allowed.has(o)) return { ok: true };

  return { ok: false, error: "Bad origin" };
}
