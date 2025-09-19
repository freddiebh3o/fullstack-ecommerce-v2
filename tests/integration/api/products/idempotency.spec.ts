// tests/integration/api/idempotency.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { prismaForTenant } from "../../../_utils/factories";
import { POST as ProductsPOST } from "@/app/api/admin/products/route";
import { PATCH as ProductPATCH } from "@/app/api/admin/products/[id]/route";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair(); // fresh token each call
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Idempotency – Products API", () => {
  test("replays the same 2xx for identical (method,path,user,tenant,Idempotency-Key)", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "idem-replay-1" });

    const sku = "IDEM-REPLAY-1";

    // First request
    const req1 = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies,
      body: json({ sku, name: "A", priceInPence: 1000 }),
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await ProductsPOST(req1 as any);
    clearNextRequestContext();
    const body1 = await parse(res1);
    expect([201, 200]).toContain(res1.status);
    expect(body1?.ok).toBe(true);

    // Second request with SAME key (should replay persisted success)
    const req2 = buildReq("/api/admin/products", {
      method: "POST",
      headers, // same Idempotency-Key
      cookies,
      body: json({ sku, name: "A (ignored)", priceInPence: 999999 }),
    });
    setNextRequestContextFromRequest(req2);
    const res2 = await ProductsPOST(req2 as any);
    clearNextRequestContext();
    const body2 = await parse(res2);

    expect(res2.status).toBe(res1.status);
    // Compare the meaningful parts; requestId can differ on replay in your impl.
    expect(body2?.ok).toBe(body1?.ok);
    expect(body2?.data).toStrictEqual(body1?.data);

    const db = prismaForTenant(tenantId);
    expect(await db.product.count({ where: { sku } })).toBe(1);
  });

  test("does not store non-2xx: bad create with a key; same key may 409; new key succeeds", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const idemKey = "idem-non2xx-1";

    const sku = "IDEM-NON2XX-1";

    // 1) Invalid create (4xx) – key should NOT be stored as success
    const badHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": idemKey });
    const badReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: badHeaders,
      cookies,
      body: json({ sku, name: "Bad", priceInPence: -5 }),
    });
    setNextRequestContextFromRequest(badReq);
    const badRes = await ProductsPOST(badReq as any);
    clearNextRequestContext();
    expect([400, 422]).toContain(badRes.status);

    // 2) Retry with the SAME key: your impl may return 409 "in progress" (reservation not cleared)
    const retrySameKeyHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": idemKey });
    const retrySameKeyReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: retrySameKeyHeaders,
      cookies,
      body: json({ sku, name: "Good (same key)", priceInPence: 1500 }),
    });
    setNextRequestContextFromRequest(retrySameKeyReq);
    const retrySameKeyRes = await ProductsPOST(retrySameKeyReq as any);
    clearNextRequestContext();
    // Accept either success or 409 'in progress' depending on reservation timing
    expect([201, 200, 409]).toContain(retrySameKeyRes.status);

    // 3) Use a NEW key → must execute and succeed (proves 4xx wasn’t stored)
    const goodHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": "idem-non2xx-1-new" });
    const goodReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: goodHeaders,
      cookies,
      body: json({ sku, name: "Good", priceInPence: 1500 }),
    });
    setNextRequestContextFromRequest(goodReq);
    const goodRes = await ProductsPOST(goodReq as any);
    clearNextRequestContext();
    const body = await parse(goodRes);
    expect([201, 200]).toContain(goodRes.status);
    expect(body?.ok).toBe(true);

    const db = prismaForTenant(tenantId);
    expect(await db.product.count({ where: { sku } })).toBe(1);
  });

  test("key scope includes tenant: same key in a different tenant does NOT replay", async () => {
    const A = await withAuthAndTenant();
    const headersA = ctxHeaders(A.headers, { "Idempotency-Key": "idem-scope-tenant" });
    const skuA = "IDEM-TENANT-A";

    const reqA = buildReq("/api/admin/products", {
      method: "POST",
      headers: headersA,
      cookies: A.cookies,
      body: json({ sku: skuA, name: "A", priceInPence: 1000 }),
    });
    setNextRequestContextFromRequest(reqA);
    const resA = await ProductsPOST(reqA as any);
    clearNextRequestContext();
    expect([201, 200]).toContain(resA.status);

    const B = await withAuthAndTenant();
    const headersB = ctxHeaders(B.headers, { "Idempotency-Key": "idem-scope-tenant" });
    const skuB = "IDEM-TENANT-B";

    const reqB = buildReq("/api/admin/products", {
      method: "POST",
      headers: headersB,
      cookies: B.cookies,
      body: json({ sku: skuB, name: "B", priceInPence: 2000 }),
    });
    setNextRequestContextFromRequest(reqB);
    const resB = await ProductsPOST(reqB as any);
    clearNextRequestContext();
    expect([201, 200]).toContain(resB.status);

    const dbA = prismaForTenant(A.tenantId);
    const dbB = prismaForTenant(B.tenantId);
    const [countA, countB] = await Promise.all([
      dbA.product.count({ where: { sku: skuA } }),
      dbB.product.count({ where: { sku: skuB } }),
    ]);
    expect(countA).toBe(1);
    expect(countB).toBe(1);
  });

  test("key scope includes method/path: same key reused for PATCH does not replay the previous POST", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // Create
    const createHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": "idem-method-1" });
    const sku = "IDEM-METHOD-1";
    const createReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: createHeaders,
      cookies,
      body: json({ sku, name: "Base", priceInPence: 500 }),
    });
    setNextRequestContextFromRequest(createReq);
    const createRes = await ProductsPOST(createReq as any);
    clearNextRequestContext();
    const createBody = await parse(createRes);
    expect([201, 200]).toContain(createRes.status);
    const productId = createBody?.data?.id as string;
    expect(productId).toBeTruthy();

    // PATCH with SAME key should *not* replay the POST
    const patchHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": "idem-method-1" });
    const patchReq = buildReq(`/api/admin/products/${productId}`, {
      method: "PATCH",
      headers: patchHeaders,
      cookies,
      body: json({ expectedVersion: 1, name: "Renamed" }),
    });
    setNextRequestContextFromRequest(patchReq);
    const patchRes = await ProductPATCH(
      patchReq as any,
      { params: Promise.resolve({ id: productId }) } as any
    );
    clearNextRequestContext();
    const patchBody = await parse(patchRes);
    expect([200]).toContain(patchRes.status);
    expect(patchBody?.ok).toBe(true);

    const after = await db.product.findUniqueOrThrow({
      where: { tenantId_sku: { tenantId, sku } },
    });
    expect(after.version).toBe(2);
    expect(after.name).toBe("Renamed");
  });
});
