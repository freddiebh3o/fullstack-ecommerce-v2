import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkProduct } from "../../../_utils/factories";
import { PATCH as ProductPATCH } from "@/app/api/admin/products/[id]/route";

function ctxHeaders(auth: Record<string,string>, extra?: Record<string,string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Products – PATCH validation (422)", () => {
  test("422 when missing expectedVersion", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const p = await mkProduct(tenantId, `VAL-${Date.now()}`, "Needs Version", { priceInPence: 1000 });

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "pp-val-1" });
    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ name: "No Version Here" }), // missing expectedVersion
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(422);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(body?.issues).toBeTruthy();
  });

  test("422 when priceInPence is negative (schema violation)", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const p = await mkProduct(tenantId, `VAL-${Date.now()}-neg`, "Neg Price", { priceInPence: 1000 });

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "pp-val-2" });
    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, priceInPence: -50 }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(422);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(body?.issues).toBeTruthy();
  });

  test("422 when body is not valid JSON", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const p = await mkProduct(tenantId, `VAL-${Date.now()}-badjson`, "Bad JSON", { priceInPence: 1000 });

    // Intentionally send malformed JSON string
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "pp-val-3" });
    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      headers,
      cookies,
      // raw body that will fail req.json()
      body: "{ this is not valid json",
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(422);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });
});
