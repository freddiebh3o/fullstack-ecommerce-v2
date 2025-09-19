// tests/integration/api/products.delete.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { prismaForTenant, uniq, sys } from "../../../_utils/factories";
import { POST as ProductsPOST } from "@/app/api/admin/products/route";
import { DELETE as ProductDELETE } from "@/app/api/admin/products/[id]/route";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair(); // fresh token each call
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Products – DELETE", () => {
  test("deletes product and writes PRODUCT_DELETE audit row", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // 1) Create a product via the real POST handler
    const sku = `DEL-${uniq()}`;
    const createHeaders = ctxHeaders(authHeaders, { "Idempotency-Key": `del-create-${uniq()}` });
    const createReq = buildReq("/api/admin/products", {
      method: "POST",
      headers: createHeaders,
      cookies,
      body: JSON.stringify({ sku, name: "ToDelete", priceInPence: 999 }),
    });

    setNextRequestContextFromRequest(createReq);
    const createRes = await ProductsPOST(createReq as any);
    clearNextRequestContext();

    expect([201, 200]).toContain(createRes.status);
    const created = await parse(createRes);
    const productId = created?.data?.id as string;
    expect(productId).toBeTruthy();

    // 2) DELETE via handler
    const deleteHeaders = ctxHeaders(authHeaders);
    const delReq = buildReq(`/api/admin/products/${productId}`, {
      method: "DELETE",
      headers: deleteHeaders,
      cookies,
    });

    setNextRequestContextFromRequest(delReq);
    const delRes = await ProductDELETE(delReq as any, { params: Promise.resolve({ id: productId }) } as any);
    clearNextRequestContext();

    // Depending on your handler, this may be 200 (envelope) or 204 (no content)
    expect([200, 204]).toContain(delRes.status);

    // 3) Verify row is gone
    const stillThere = await db.product.count({ where: { id: productId } });
    expect(stillThere).toBe(0);

    // 4) Audit row exists
    const audits = await (sys as any).auditLog.findMany({
      where: { tenantId, action: "PRODUCT_DELETE", entityType: "Product", entityId: productId },
      orderBy: { createdAt: "desc" },
      take: 1,
    });
    expect(audits.length).toBe(1);
    expect(audits[0].tenantId).toBe(tenantId);
    expect(audits[0].action).toBe("PRODUCT_DELETE");
  });

  test("404 when deleting unknown id (envelope preserved)", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const fakeId = `not-a-real-id-${uniq()}`;
    const headers = ctxHeaders(authHeaders);
    const req = buildReq(`/api/admin/products/${fakeId}`, {
      method: "DELETE",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductDELETE(req as any, { params: Promise.resolve({ id: fakeId }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
    expect(typeof body?.requestId).toBe("string");
  });
});
