// tests/integration/api/products.permissions.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member, mkProduct } from "../../../_utils/factories";
import { GET as ProductsGET } from "@/app/api/admin/products/route";
import { GET as ProductGET, PATCH as ProductPATCH, DELETE as ProductDELETE } from "@/app/api/admin/products/[id]/route";

function headersFor(user: { id: string; email: string | null }, extra?: Record<string,string>) {
  const { headers: csrf } = csrfPair();
  return mergeHeaders(
    {
      "x-test-user-id": user.id,
      "x-test-user-email": user.email ?? "user@example.com",
      "content-type": "application/json",
    },
    csrf,
    extra ?? {}
  );
}

describe("Products – permissions (managers only)", () => {
  test("non-manager (viewer) is 403 for list, get, patch, delete", async () => {
    const t = await mkTenant();
    const manager = await mkUser();
    const viewer = await mkUser();

    // Seed memberships
    await member(manager.id, t.id, { canManageProducts: true, canViewProducts: true });
    await member(viewer.id,  t.id, { canManageProducts: false, canViewProducts: true });

    // Seed one product
    const p = await mkProduct(t.id, `PERM-${Date.now()}`, "Perm Test", { priceInPence: 1234 });

    // Viewer tries LIST
    {
      const req = buildReq(`/api/admin/products`, {
        method: "GET",
        headers: headersFor(viewer),
        cookies: { tenant_id: t.id },
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsGET(req as any);
      clearNextRequestContext();
      expect(res.status).toBe(403);
      const body = await parse(res);
      expect(body?.ok).toBe(false);
    }

    // Viewer tries GET by id
    {
      const req = buildReq(`/api/admin/products/${p.id}`, {
        method: "GET",
        headers: headersFor(viewer),
        cookies: { tenant_id: t.id },
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductGET(req as any, { params: Promise.resolve({ id: p.id }) });
      clearNextRequestContext();
      expect(res.status).toBe(403);
    }

    // Viewer tries PATCH
    {
      const req = buildReq(`/api/admin/products/${p.id}`, {
        method: "PATCH",
        headers: headersFor(viewer, { "Idempotency-Key": "perm-v-patch-1" }),
        cookies: { tenant_id: t.id },
        body: json({ expectedVersion: 1, name: "Nope" }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: p.id }) });
      clearNextRequestContext();
      expect(res.status).toBe(403);
    }

    // Viewer tries DELETE
    {
      const req = buildReq(`/api/admin/products/${p.id}`, {
        method: "DELETE",
        headers: headersFor(viewer),
        cookies: { tenant_id: t.id },
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductDELETE(req as any, { params: Promise.resolve({ id: p.id }) });
      clearNextRequestContext();
      expect(res.status).toBe(403);
    }
  });
});
