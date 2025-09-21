// tests/integration/api/products.get-and-delete.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member, mkProduct, prismaForTenant } from "../../../_utils/factories";
import { GET as ProductGET, DELETE as ProductDELETE } from "@/app/api/admin/products/[id]/route";

// Helper: GETs don't need CSRF; DELETE does
function getHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  return mergeHeaders(auth, { "content-type": "application/json" }, extra);
}
function delHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Products – GET by id & DELETE", () => {
  test("GET /api/admin/products/[id] returns expected shape for managers", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const p = await mkProduct(tenantId, `GET-${Math.random().toString(36).slice(2,8)}`, "Show One", { priceInPence: 1234 });

    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "GET",
      headers: getHeaders(authHeaders),
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductGET(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const data = body.data;
    expect(data.id).toBe(p.id);
    expect(data.sku).toBe(p.sku);
    expect(data.name).toBe("Show One");
    expect(typeof data.priceInPence).toBe("number");
    expect(typeof data.version).toBe("number");
    expect(data.createdAt).toBeTruthy();
    expect(data.updatedAt).toBeTruthy();
  });

  test("GET is 403 for non-managers", async () => {
    // Tenant with a non-manager user
    const t = await mkTenant();
    const mgr = await mkUser();
    const viewer = await mkUser();
    await member(mgr.id, t.id, { isOwner: true, canManageProducts: true });
    await member(viewer.id, t.id, { canViewProducts: true }); // NOT a manager

    const p = await mkProduct(t.id);

    const { headers: viewerHeaders } = (() => {
      const base = { "x-test-user-id": viewer.id, "x-test-user-email": viewer.email ?? "viewer@example.com" };
      return { headers: getHeaders(base) };
    })();

    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "GET",
      headers: viewerHeaders,
      cookies: { tenant_id: t.id },
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductGET(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });

  test("DELETE succeeds for managers and writes PRODUCT_DELETE audit", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);
    const p = await mkProduct(tenantId, `DEL-${Math.random().toString(36).slice(2,8)}`, "To Delete");

    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "DELETE",
      headers: delHeaders(authHeaders, { "Idempotency-Key": "prod-del-1" }),
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductDELETE(req as any, { params: Promise.resolve({ id: p.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);

    // gone from DB
    const exists = await db.product.findFirst({ where: { id: p.id } });
    expect(exists).toBeNull();

    // audit present
    const audit = await db.auditLog.findMany({ where: { action: "PRODUCT_DELETE", entityId: p.id } });
    expect(audit.length).toBeGreaterThanOrEqual(1);
  });

  test("DELETE 404 when product id not found", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();
    const fake = "00000000-0000-0000-0000-000000000000";

    const req = buildReq(`/api/admin/products/${fake}`, {
      method: "DELETE",
      headers: delHeaders(authHeaders, { "Idempotency-Key": "prod-del-404" }),
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductDELETE(req as any, { params: Promise.resolve({ id: fake }) });
    clearNextRequestContext();

    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });
});
