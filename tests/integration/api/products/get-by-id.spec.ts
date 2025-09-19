// tests/integration/api/products.get-by-id.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { prismaForTenant, mkProduct, uniq } from "../../../_utils/factories";
import { GET as ProductGET } from "@/app/api/admin/products/[id]/route";

describe("Products – GET by id", () => {
  test("returns a single product with version", async () => {
    // auth + tenant context
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // seed a product directly in DB for this tenant
    const sku = `GETBYID-${uniq()}`;
    const seeded = await mkProduct(tenantId, sku, "GetById", { priceInPence: 1234 });

    // call the GET handler
    const req = buildReq(`/api/admin/products/${seeded.id}`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductGET(req as any, { params: Promise.resolve({ id: seeded.id }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(200);

    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const p = body?.data;
    expect(p?.id).toBe(seeded.id);
    expect(p?.sku).toBe(sku);
    expect(typeof p?.version).toBe("number");
    expect(p?.version).toBeGreaterThanOrEqual(1);

    // just to be safe, confirm it’s still there in tenant DB
    const found = await db.product.findUniqueOrThrow({ where: { tenantId_sku: { tenantId, sku } } });
    expect(found.id).toBe(seeded.id);
  });

  test("404 for unknown id (envelope shape preserved)", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const fakeId = "not-a-real-id-" + uniq();
    const req = buildReq(`/api/admin/products/${fakeId}`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductGET(req as any, { params: Promise.resolve({ id: fakeId }) } as any);
    clearNextRequestContext();

    expect(res.status).toBe(404);

    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(typeof body?.error).toBe("string");
    // requestId should be echoed in the body per your guardrails
    expect(typeof body?.requestId).toBe("string");
  });
});
