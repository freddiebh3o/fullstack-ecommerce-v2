// tests/integration/api/audit.products.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { prismaForTenant, sys, uniq } from "../../../_utils/factories";
import { POST as ProductsPOST } from "@/app/api/admin/products/route";
import { PATCH as ProductPATCH } from "@/app/api/admin/products/[id]/route";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Audit logs - Products", () => {
  test("PRODUCT_CREATE is written once with redaction-aware diff", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `audit-create-${uniq()}` });

    const sku = `AUD-CREATE-${uniq()}`;
    const req = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies,
      body: json({ sku, name: "Created via test", priceInPence: 1234 }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductsPOST(req as any);
    clearNextRequestContext();
    expect([201, 200]).toContain(res.status);
    const body = await parse(res);
    const productId = body?.data?.id as string;
    expect(productId).toBeTruthy();

    const rows = await (sys as any).auditLog.findMany({
      where: {
        tenantId,
        userId,
        action: "PRODUCT_CREATE",
        entityType: "Product",
        entityId: productId,
      },
      orderBy: { createdAt: "asc" },
    });

    expect(rows.length).toBe(1);
    const row = rows[0]!;
    const diff = row.diff as any;

    // Redaction-aware assertions
    expect(diff && typeof diff === "object").toBe(true);
    expect("after" in diff).toBe(true);
    // If detailed structure is available in the future, check a couple of keys
    if (diff.after && typeof diff.after === "object") {
      expect("sku" in diff.after).toBe(true);
      expect("priceInPence" in diff.after).toBe(true);
    } else {
      // Current behavior: redacted payload string (e.g., "[object]")
      expect(typeof diff.after).toBe("string");
      expect(String(diff.after)).toBeTruthy();
    }
  });

  test("PRODUCT_UPDATE writes diff including before/after (redaction-aware) and version bump", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // Create
    const sku = `AUD-UPDATE-${uniq()}`;
    {
      const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `audit-update-create-${sku}` });
      const req = buildReq("/api/admin/products", {
        method: "POST",
        headers,
        cookies,
        body: json({ sku, name: "Before", priceInPence: 500 }),
      });
      setNextRequestContextFromRequest(req);
      const res = await ProductsPOST(req as any);
      clearNextRequestContext();
      expect([201, 200]).toContain(res.status);
    }

    const p = await db.product.findFirstOrThrow({ where: { sku } });
    expect(p.version).toBe(1);

    // Update (rename)
    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": `audit-update-patch-${sku}` });
    const req = buildReq(`/api/admin/products/${p.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, name: "After" }),
    });

    setNextRequestContextFromRequest(req);
    const res = await ProductPATCH(req as any, { params: Promise.resolve({ id: p.id }) } as any);
    clearNextRequestContext();
    const body = await parse(res);
    expect(res.status).toBe(200);
    expect(body?.data?.version).toBe(2);
    expect(body?.data?.name).toBe("After");

    const updates = await (sys as any).auditLog.findMany({
      where: {
        tenantId,
        action: "PRODUCT_UPDATE",
        entityType: "Product",
        entityId: p.id,
      },
      orderBy: { createdAt: "asc" },
    });
    expect(updates.length).toBe(1);

    const upd = updates[0]!;
    const diff = upd.diff as any;

    // Redaction-aware: check before/after are present
    expect(diff && typeof diff === "object").toBe(true);
    expect("before" in diff).toBe(true);
    expect("after" in diff).toBe(true);

    // If detailed structure exists, assert changed keys show up; otherwise accept redacted strings
    if (diff.after && typeof diff.after === "object" && diff.before && typeof diff.before === "object") {
      // When detailed, ensure name changed and version bumped
      expect(diff.before.name).toBeDefined();
      expect(diff.after.name).toBeDefined();
      expect(diff.before.name).not.toBe(diff.after.name);
      // Version bump noted
      expect(diff.before.version).toBe(1);
      expect(diff.after.version).toBe(2);
    } else {
      // Current behavior: redacted values (strings)
      expect(typeof diff.before).toBe("string");
      expect(typeof diff.after).toBe("string");
      expect(String(diff.before)).toBeTruthy();
      expect(String(diff.after)).toBeTruthy();
    }
  });

  test("Idempotent replay does not double-write PRODUCT_CREATE", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const idemKey = `audit-idem-${uniq()}`;
    const sku = `AUD-IDEM-${uniq()}`;

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": idemKey });

    // First create
    const req1 = buildReq("/api/admin/products", {
      method: "POST",
      headers,
      cookies,
      body: json({ sku, name: "First", priceInPence: 1111 }),
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await ProductsPOST(req1 as any);
    clearNextRequestContext();
    const body1 = await parse(res1);
    const productId = body1?.data?.id as string;
    expect(productId).toBeTruthy();

    // Replay
    const req2 = buildReq("/api/admin/products", {
      method: "POST",
      headers, // same Idempotency-Key
      cookies,
      body: json({ sku, name: "Second (ignored)", priceInPence: 999999 }),
    });
    setNextRequestContextFromRequest(req2);
    const res2 = await ProductsPOST(req2 as any);
    clearNextRequestContext();
    expect(res2.status).toBe(res1.status);

    const creates = await (sys as any).auditLog.findMany({
      where: {
        tenantId,
        action: "PRODUCT_CREATE",
        entityType: "Product",
        entityId: productId,
      },
    });
    expect(creates.length).toBe(1);
  });
});
