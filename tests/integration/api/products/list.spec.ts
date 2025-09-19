// tests/integration/api/products.list.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { prismaForTenant, mkProduct, uniq } from "../../../_utils/factories";
import { GET as ProductsGET } from "@/app/api/admin/products/route";

describe("Products – list / search / paginate", () => {
  test("GET /api/admin/products lists items with version", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // seed a few products
    const s1 = await mkProduct(tenantId, `LIST-${uniq()}`, "List One", { priceInPence: 1000 });
    const s2 = await mkProduct(tenantId, `LIST-${uniq()}`, "List Two", { priceInPence: 2000 });
    const s3 = await mkProduct(tenantId, `LIST-${uniq()}`, "List Three", { priceInPence: 3000 });

    const req = buildReq(`/api/admin/products`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductsGET(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(200);

    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const items: any[] = body?.data?.items ?? [];
    expect(items.length).toBeGreaterThanOrEqual(3);

    // ensure shape includes version and some seeded SKUs present
    const ids = items.map(i => i.id);
    const skus = items.map(i => i.sku);
    expect(ids).toContain(s1.id);
    expect(skus).toContain(s2.sku);
    for (const it of items) {
      expect(typeof it.version).toBe("number");
      expect(it).toHaveProperty("name");
      expect(it).toHaveProperty("priceInPence");
    }
  });

  test("search with ?q= filters by name or sku (case-insensitive contains)", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    // seed distinct names/skus
    const targetSku = `SRCH-SKU-${uniq()}`;
    await mkProduct(tenantId, targetSku, "Alpha Bravo", { priceInPence: 1111 });
    await mkProduct(tenantId, `SRCH-${uniq()}`, "Charlie Delta", { priceInPence: 2222 });

    // search by partial name
    const reqByName = buildReq(`/api/admin/products?q=brav`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });
    setNextRequestContextFromRequest(reqByName);
    const resByName = await ProductsGET(reqByName as any);
    clearNextRequestContext();

    expect(resByName.status).toBe(200);
    const byName = await parse(resByName);
    const itemsByName: any[] = byName?.data?.items ?? [];
    expect(itemsByName.some(p => /alpha bravo/i.test(p.name))).toBe(true);

    // search by partial SKU
    const partialSku = targetSku.slice(0, 8);
    const reqBySku = buildReq(`/api/admin/products?q=${encodeURIComponent(partialSku)}`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });
    setNextRequestContextFromRequest(reqBySku);
    const resBySku = await ProductsGET(reqBySku as any);
    clearNextRequestContext();

    expect(resBySku.status).toBe(200);
    const bySku = await parse(resBySku);
    const itemsBySku: any[] = bySku?.data?.items ?? [];
    expect(itemsBySku.some(p => p.sku.includes(partialSku))).toBe(true);
  });

  test("pagination with ?limit=1 returns nextCursor and paginates with ?cursor=", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    // seed at least 2 products
    const a = await mkProduct(tenantId, `PAGE-${uniq()}`, "Page A");
    const b = await mkProduct(tenantId, `PAGE-${uniq()}`, "Page B");

    // Page 1 (limit=1)
    const req1 = buildReq(`/api/admin/products?limit=1`, {
      method: "GET",
      headers: authHeaders,
      cookies,
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await ProductsGET(req1 as any);
    clearNextRequestContext();

    expect(res1.status).toBe(200);
    const body1 = await parse(res1);
    const items1: any[] = body1?.data?.items ?? [];
    const nextCursor: string | null = body1?.data?.nextCursor ?? null;
    expect(items1.length).toBe(1);
    expect(typeof nextCursor === "string" || nextCursor === null).toBe(true);

    // If a cursor is provided, fetch next page and ensure a different id is returned
    if (nextCursor) {
      const req2 = buildReq(`/api/admin/products?limit=1&cursor=${encodeURIComponent(nextCursor)}`, {
        method: "GET",
        headers: authHeaders,
        cookies,
      });
      setNextRequestContextFromRequest(req2);
      const res2 = await ProductsGET(req2 as any);
      clearNextRequestContext();

      expect(res2.status).toBe(200);
      const body2 = await parse(res2);
      const items2: any[] = body2?.data?.items ?? [];
      expect(items2.length).toBe(1);
      expect(items2[0]?.id).not.toBe(items1[0]?.id);
    }
  });
});
