// tests/integration/api/products.validation.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { uniq } from "../../../_utils/factories";
import { POST as ProductsPOST } from "@/app/api/admin/products/route";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Products – validation & error mapping", () => {
  test("duplicate SKU in same tenant → 409 Conflict (envelope preserved)", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();
    const sku = `VAL-${uniq()}`;

    // 1) First create (should succeed)
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `val-dup-ok-${uniq()}` });
      const req = buildReq("/api/admin/products", {
        method: "POST",
        headers,
        cookies,
        body: JSON.stringify({ sku, name: "One", priceInPence: 1000 }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsPOST(req as any);
      clearNextRequestContext();

      expect([201, 200]).toContain(res.status);
      const body = await parse(res);
      expect(body?.ok).toBe(true);
    }

    // 2) Second create with same SKU & a different idempotency key → expect 409
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `val-dup-conflict-${uniq()}` });
      const req = buildReq("/api/admin/products", {
        method: "POST",
        headers,
        cookies,
        body: JSON.stringify({ sku, name: "Two", priceInPence: 2000 }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsPOST(req as any);
      clearNextRequestContext();

      expect(res.status).toBe(409);
      const body = await parse(res);
      expect(body?.ok).toBe(false);
      expect(typeof body?.error).toBe("string");
      expect(typeof body?.requestId).toBe("string");
    }
  });

  test("strict schema: unknown fields → 422 with issues", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `val-unknown-${uniq()}` });

    const req = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies,
      body: JSON.stringify({
        sku: `VAL-UF-${uniq()}`,
        name: "Bad Extra",
        priceInPence: 1000,
        extra: "nope", // should be rejected by .strict()
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductsPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(422);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    // your fail(422, ...) adds issues.flatten() -> { fieldErrors, formErrors }
    expect(body?.issues).toBeTruthy();
  });

  test("missing/invalid fields → 422 (e.g., missing price or wrong type)", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    // Missing required field (priceInPence)
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `val-missing-${uniq()}` });
      const req = buildReq("/api/admin/products", {
        method: "POST",
        headers,
        cookies,
        body: JSON.stringify({ sku: `VAL-MISS-${uniq()}`, name: "No Price" }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsPOST(req as any);
      clearNextRequestContext();

      expect(res.status).toBe(422);
      const body = await parse(res);
      expect(body?.ok).toBe(false);
      expect(body?.issues).toBeTruthy();
    }

    // Wrong type (priceInPence as string)
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `val-badtype-${uniq()}` });
      const req = buildReq("/api/admin/products", {
        method: "POST",
        headers,
        cookies,
        body: JSON.stringify({ sku: `VAL-BADTYPE-${uniq()}`, name: "Wrong Type", priceInPence: "1000" }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsPOST(req as any);
      clearNextRequestContext();

      expect(res.status).toBe(422);
      const body = await parse(res);
      expect(body?.ok).toBe(false);
      expect(body?.issues).toBeTruthy();
    }
  });
});
