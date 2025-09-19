// tests/unit/security/csrf.spec.ts
import { describe, test, expect } from "vitest";
import { verifyDoubleSubmit } from "@/lib/security/csrf";

// Minimal NextRequest-like shim for verifyDoubleSubmit
function mkReq(opts: {
  method?: string;
  headers?: Record<string, string>;
  cookies?: Record<string, string>;
}) {
  const method = opts.method ?? "POST";
  const headers = new Headers(opts.headers ?? {});
  const cookieStr = Object.entries(opts.cookies ?? {})
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
  if (cookieStr) headers.set("cookie", cookieStr);

  const req: any = {
    method,
    headers,
    cookies: {
      get(name: string) {
        const jar = Object.fromEntries(
          (cookieStr ? cookieStr.split("; ") : [])
            .filter(Boolean)
            .map((p) => p.split("=") as [string, string])
        );
        const val = jar[name];
        return val ? { name, value: decodeURIComponent(val) } : undefined;
      },
    },
  };
  return req;
}

describe("verifyDoubleSubmit", () => {
  test("rejects when missing both cookie and header", () => {
    const req = mkReq({ method: "POST" });
    const res = verifyDoubleSubmit(req);
    expect(res.ok).toBe(false);
  });

  test("rejects when only header is present", () => {
    const req = mkReq({ method: "POST", headers: { "x-csrf-token": "t" } });
    const res = verifyDoubleSubmit(req);
    expect(res.ok).toBe(false);
  });

  test("rejects when only cookie is present", () => {
    const req = mkReq({ method: "POST", cookies: { csrf_token: "t" } });
    const res = verifyDoubleSubmit(req);
    expect(res.ok).toBe(false);
  });

  test("accepts when cookie and header match", () => {
    const token = "match-123";
    const req = mkReq({
      method: "POST",
      headers: { "x-csrf-token": token },
      cookies: { csrf_token: token }, // <-- match implementation
    });
    const res = verifyDoubleSubmit(req);
    expect(res.ok).toBe(true);
  });

  // NOTE: verifyDoubleSubmit itself does NOT skip safe methods.
  // If you want GET/HEAD/OPTIONS to be allowed without tokens,
  // that should be enforced by middleware choosing when to call it.
  // So we assert behavior explicitly:

  test("for safe methods without tokens, verifyDoubleSubmit still returns false", () => {
    for (const m of ["GET", "HEAD", "OPTIONS"] as const) {
      const req = mkReq({ method: m });
      const res = verifyDoubleSubmit(req);
      expect(res.ok).toBe(false);
    }
  });

  test("for safe methods with matching tokens, returns true", () => {
    const token = "safe-xyz";
    for (const m of ["GET", "HEAD", "OPTIONS"] as const) {
      const req = mkReq({
        method: m,
        headers: { "x-csrf-token": token },
        cookies: { csrf_token: token },
      });
      const res = verifyDoubleSubmit(req);
      expect(res.ok).toBe(true);
    }
  });
});
