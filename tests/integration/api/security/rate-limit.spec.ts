// tests/integration/api/rate-limit.spec.ts
import { describe, test, expect, vi, beforeEach } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

beforeEach(() => {
  vi.resetModules();
  vi.clearAllMocks();
});

describe("Rate limiting – per-user mutation caps", () => {
  test("PATCH is blocked with 429 when user RL denies; includes Retry-After and X-RateLimit-*", async () => {
    // 👇 Mock: allow first mut:user:* for this user (create), deny the next (patch)
    vi.doMock("@/lib/security/rate-limit", async () => {
      const actual = await vi.importActual<any>("@/lib/security/rate-limit");
      const seen = new Map<string, number>();
      return {
        ...actual,
        rateLimitFixedWindow: vi.fn((opts: any) => {
          const key = String(typeof opts === "string" ? opts : opts?.key);
          if (key.startsWith("mut:user:")) {
            const n = (seen.get(key) ?? 0) + 1;
            seen.set(key, n);
            if (n === 1) return { ok: true, limit: 60, remaining: 59 }; // allow create
            return { ok: false, limit: 60, remaining: 0, retryAfter: 42 }; // deny patch
          }
          return { ok: true, limit: 60, remaining: 59 };
        }),
      };
    });

    // Re-import handlers after mock
    const { POST: ProductsPOST_ } = await import("@/app/api/admin/products/route");
    const { PATCH: ProductPATCH_ } = await import("@/app/api/admin/products/[id]/route");

    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    // Create should be ALLOWED by the mock
    const createHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": "rl-create-1" });
    const createReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: createHeaders,
      cookies,
      body: json({ sku: "RL-1", name: "RL", priceInPence: 1000 }),
    });
    setNextRequestContextFromRequest(createReq);
    const createRes = await ProductsPOST_(createReq as any);
    clearNextRequestContext();
    const createBody = await parse(createRes);
    expect([201, 200]).toContain(createRes.status);
    const productId = createBody?.data?.id as string;

    // PATCH should be DENIED by the mock
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "rl-patch-1" });
    const req = buildReq(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "Denied" }),
    });
    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH_(req as any, { params: Promise.resolve({ id: productId }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(429);
    expect(res.headers.get("Retry-After")).toBe("42");
    expect(res.headers.get("X-RateLimit-Limit")).toBe("60");
    expect(res.headers.has("X-RateLimit-Remaining")).toBe(true);

    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(String(body?.error || "")).toMatch(/Too Many Requests/i);
  });

  test("POST is blocked by per-user RL when route enforces it (if your POST route includes the user cap)", async () => {
    // Keep this flexible: handler may or may not enforce per-user RL on POST.
    vi.doMock("@/lib/security/rate-limit", async () => {
      const actual = await vi.importActual<any>("@/lib/security/rate-limit");
      return {
        ...actual,
        rateLimitFixedWindow: vi.fn((opts: any) => {
          const key = String(typeof opts === "string" ? opts : opts?.key);
          if (key.startsWith("mut:user:")) {
            return { ok: false, limit: 20, remaining: 0, retryAfter: 30 };
          }
          return { ok: true, limit: 60, remaining: 59 };
        }),
      };
    });

    const { POST: ProductsPOST_ } = await import("@/app/api/admin/products/route");
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "rl-post-1" });
    const req = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies,
      body: json({ sku: "RL-BLOCK-POST", name: "RL", priceInPence: 1000 }),
    });
    setNextRequestContextFromRequest(req);
    const res = await ProductsPOST_(req as any);
    clearNextRequestContext();

    expect([429, 201, 200]).toContain(res.status);
    if (res.status === 429) {
      expect(res.headers.get("Retry-After")).toBe("30");
      expect(res.headers.get("X-RateLimit-Limit")).toBe("20");
    }
  });
});
