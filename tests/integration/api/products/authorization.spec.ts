import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, mergeHeaders, parse } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member, mkProduct, prismaForTenant } from "../../../_utils/factories";
import { GET as ProductGET, DELETE as ProductDELETE } from "@/app/api/admin/products/[id]/route";

function headersFor(user: { id: string; email?: string }) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(
    {
      "x-test-user-id": user.id,
      "x-test-user-email": user.email ?? "user@example.com",
      "content-type": "application/json",
    },
    csrfHeaders
  );
}

describe("Products – authorization guards", () => {
  test("GET /api/admin/products/[id] is 403 for non-product-managers", async () => {
    const t = await mkTenant();
    const manager = await mkUser();
    const viewer = await mkUser();

    await member(manager.id, t.id, { canManageProducts: true });
    await member(viewer.id, t.id, { canManageProducts: false, canViewProducts: true });

    const p = await mkProduct(t.id, `AUTH-G-${Date.now()}`, "Guard Get");

    const headers = headersFor(viewer);
    const cookies = { tenant_id: t.id };

    const req = buildReq(`/api/admin/products/${p.id}`, { method: "GET", headers, cookies });
    setNextRequestContextFromRequest(req);
    const res = await ProductGET(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });

  test("DELETE /api/admin/products/[id] is 403 for non-product-managers and does not delete", async () => {
    const t = await mkTenant();
    const viewer = await mkUser();
    await member(viewer.id, t.id, { canManageProducts: false, canViewProducts: true });

    const p = await mkProduct(t.id, `AUTH-D-${Date.now()}`, "Guard Delete");

    const headers = headersFor(viewer);
    const cookies = { tenant_id: t.id };

    const req = buildReq(`/api/admin/products/${p.id}`, { method: "DELETE", headers, cookies });
    setNextRequestContextFromRequest(req);
    const res = await ProductDELETE(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);

    // still exists
    const db = prismaForTenant(t.id);
    const count = await db.product.count({ where: { id: p.id } });
    expect(count).toBe(1);
  });
});
