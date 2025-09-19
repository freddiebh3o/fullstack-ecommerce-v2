// tests/unit/security/headers.spec.ts
import { describe, test, expect } from "vitest";
import { NextResponse } from "next/server";
import { applySecurityHeaders } from "@/lib/security/headers";

function expectCoreHeaders(res: NextResponse) {
  // Case-insensitive, but use canonical names for readability
  const mustExist = [
    "Content-Security-Policy",
    "X-Frame-Options",
    "X-Content-Type-Options",
    "Referrer-Policy",
    "Permissions-Policy",
  ];

  for (const h of mustExist) {
    const v = res.headers.get(h);
    expect(v, `Expected header ${h} to be set`).toBeTruthy();
    expect(String(v).trim().length).toBeGreaterThan(0);
  }
}

describe("applySecurityHeaders", () => {
  test("sets hardened headers on a successful response", () => {
    const res = NextResponse.json({ ok: true }, { status: 200 });
    applySecurityHeaders(undefined as any, res);

    expectCoreHeaders(res);

    // A couple of common exact-value checks (relax if your impl differs)
    expect(res.headers.get("X-Content-Type-Options")).toMatch(/nosniff/i);
    expect(res.headers.get("X-Frame-Options")).toMatch(/deny|sameorigin/i);
  });

  test("sets hardened headers on an error response as well", () => {
    const res = NextResponse.json({ ok: false, error: "Forbidden" }, { status: 403 });
    applySecurityHeaders(undefined as any, res);

    expectCoreHeaders(res);

    // Headers should not disappear on error responses
    expect(res.headers.get("Referrer-Policy")).toBeTruthy();
  });
});
