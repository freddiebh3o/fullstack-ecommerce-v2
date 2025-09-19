// tests/integration/api/occ.products.spec.ts
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
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

async function createProduct({
  sku,
  name = "Prod",
  priceInPence = 1000,
  authHeaders,
  cookies,
}: {
  sku: string;
  name?: string;
  priceInPence?: number;
  authHeaders: Record<string, string>;
  cookies: Record<string, string>;
}) {
  const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `occ-create-${sku}` });
  const req = buildReq("/api/admin/products", {
    method: "POST",
    headers,
    cookies,
    body: json({ sku, name, priceInPence }),
  });
  setNextRequestContextFromRequest(req);
  const res = await ProductsPOST(req as any);
  clearNextRequestContext();
  const body = await parse(res);
  expect([201, 200]).toContain(res.status);
  return body.data as { id: string; version: number; sku: string };
}

describe("OCC – Products PATCH", () => {
  test("successful PATCH with expectedVersion increments version", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const created = await createProduct({ sku: "OCC-OK-1", authHeaders, cookies });
    expect(created.version).toBe(1);

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-ok-1" });
    const req = buildReq(`/api/admin/products/${created.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "Renamed OK" }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: created.id }) } as any);
    clearNextRequestContext();

    const body = await parse(res);
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.data?.version).toBe(2);
    expect(body?.data?.name).toBe("Renamed OK");

    const after = await db.product.findUniqueOrThrow({
      where: { tenantId_sku: { tenantId, sku: "OCC-OK-1" } },
    });
    expect(after.version).toBe(2);
    expect(after.name).toBe("Renamed OK");
  });

  test("stale expectedVersion → 409 with { expectedVersion, currentVersion } and no changes applied", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const created = await createProduct({ sku: "OCC-STALE-1", authHeaders, cookies });

    // First update bumps to version 2
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-stale-priming" });
      const req = buildReq(`/api/admin/products/${created.id}`, {
        method: "PATCH",
        headers,
        cookies,
        body: json({ expectedVersion: 1, name: "v2" }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: created.id }) } as any);
      clearNextRequestContext();
      expect(res.status).toBe(200);
    }

    // Second update incorrectly sends expectedVersion:1 → should 409
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-stale-1" });
    const req = buildReq(`/api/admin/products/${created.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "won't apply" }),
    });
    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: created.id }) } as any);
    clearNextRequestContext();

    const body = await parse(res);
    expect(res.status).toBe(409);
    expect(body?.ok).toBe(false);
    expect(body?.error).toMatch(/Version conflict/i);
    expect(body?.currentVersion).toBe(2);
    expect(body?.expectedVersion).toBe(1);

    const after = await db.product.findUniqueOrThrow({
      where: { tenantId_sku: { tenantId, sku: "OCC-STALE-1" } },
    });
    expect(after.version).toBe(2);
    expect(after.name).toBe("v2"); // unchanged
  });

  test("PATCH 404 when product id not found", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-404-1" });
    const req = buildReq(`/api/admin/products/not-a-real-id`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "whatever" }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: "not-a-real-id" }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });

  test("double-submit with same expectedVersion: first 200, second 409 (not idempotent across OCC)", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const created = await createProduct({ sku: "OCC-DOUBLE-1", authHeaders, cookies });

    // First succeeds (v1 -> v2)
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-double-1-a" });
      const req = buildReq(`/api/admin/products/${created.id}`, {
        method: "PATCH",
        headers,
        cookies,
        body: json({ expectedVersion: 1, name: "v2" }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: created.id }) } as any);
      clearNextRequestContext();
      expect(res.status).toBe(200);
    }

    // Second attempt with same expectedVersion should 409 (stale)
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "occ-double-1-b" });
    const req = buildReq(`/api/admin/products/${created.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "ignored" }),
    });
    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: created.id }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(409);
  });
});
