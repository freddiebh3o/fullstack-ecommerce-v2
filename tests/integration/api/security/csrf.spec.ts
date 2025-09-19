// tests/integration/api/security.csrf.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { POST as ProductsPOST } from "@/app/api/admin/products/route";

describe("product create (handler) – happy path with CSRF", () => {
  test("succeeds with cookie + x-csrf-token", async () => {
    const { headers: authHeaders, cookies: authCookies } = await withAuthAndTenant();
    const { headers: csrfHeaders, cookies: csrfCookies } = csrfPair();

    const headers = mergeHeaders(authHeaders, csrfHeaders, {
      "content-type": "application/json",
      "Idempotency-Key": "csrf-happy-1",
    });

    const req = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies: { ...authCookies, ...csrfCookies },
      body: json({ sku: "HAPPY-1", name: "With CSRF", priceInPence: 1000 }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductsPOST(req as any);
    clearNextRequestContext();

    expect([201, 200]).toContain(res.status);
    const body = await parse(res);
    expect(body?.ok).toBe(true);
    expect(body?.data).toBeDefined();
  });
});
