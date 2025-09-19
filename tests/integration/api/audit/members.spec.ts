// tests/integration/api/audit.members.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkUser, prismaForTenant, sys } from "../../../_utils/factories";
import { POST as MembersPOST } from "@/app/api/admin/members/route";
import { PATCH as MemberPATCH, DELETE as MemberDELETE } from "@/app/api/admin/members/[id]/route";

// Helper to assemble auth+csrf headers
function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair(); // fresh token each call
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

// --- audit DB helpers: try system first, then tenant DB ---
async function findAuditOne(where: Record<string, any>, tenantId: string) {
  const whereNoTenant = { ...where };
  delete whereNoTenant.tenantId;

  const variants = [where, whereNoTenant];

// 1) Try system DB
  for (const w of variants) {
    const sysRows = await (sys as any).auditLog.findMany({
    where: w,
    orderBy: { createdAt: "desc" },
    take: 1,
    });
    if (sysRows.length) return sysRows[0];
  }

// 2) Try tenant DB
  const db = prismaForTenant(tenantId) as any;
  for (const w of variants) {
    const tenRows = await db.auditLog.findMany({
    where: w,
    orderBy: { createdAt: "desc" },
    take: 1,
    });
    if (tenRows.length) return tenRows[0];
  }

  return null;
}
  
async function countAudit(where: Record<string, any>, tenantId: string) {
  const whereNoTenant = { ...where };
  delete whereNoTenant.tenantId;

  // System DB first 
  let c = await (sys as any).auditLog.count({ where });
  if (c > 0) return c;
  c = await (sys as any).auditLog.count({ where: whereNoTenant });
  if (c > 0) return c;

  // Tenant DB
  const db = prismaForTenant(tenantId) as any;
  c = await db.auditLog.count({ where });
  if (c > 0) return c;
  return db.auditLog.count({ where: whereNoTenant });
}

describe("Audit logs – Members", () => {
  test("MEMBERSHIP_CREATE is written once with redaction-aware diff", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser();

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-audit-create-1" });
    const req = buildReq("/api/admin/members", {
      method: "POST",
      headers,
      cookies,
      body: json({
        email: target.email,
        caps: { canManageMembers: true, canManageProducts: false, canViewProducts: true, isOwner: false },
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(201);
    const body = await parse(res);
    const membershipId = body?.data?.membershipId as string;
    expect(membershipId).toBeTruthy();

    const row = await findAuditOne(
      { tenantId, action: "MEMBERSHIP_CREATE", entityType: "Membership", entityId: membershipId },
      tenantId
    );
    expect(!!row).toBe(true);

    const diff = row!.diff as any;
    // redaction-aware: either object with fields or string token
    if (diff && typeof diff === "object") {
      expect("after" in diff).toBe(true);
      // if detailed, we might see nested caps
      if (diff.after && typeof diff.after === "object") {
        expect("caps" in diff.after).toBe(true);
      }
    } else {
      expect(typeof diff).toBe("string");
      expect(String(diff)).toBeTruthy();
    }
  });

  test("MEMBERSHIP_UPDATE writes diff including before/after (redaction-aware) and version bump if detailed", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser();

    // Create first
    const h1 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-audit-update-1" });
    const createReq = buildReq("/api/admin/members", {
      method: "POST",
      headers: h1,
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: true } }),
    });
    setNextRequestContextFromRequest(createReq);
    const createRes = await MembersPOST(createReq as any);
    clearNextRequestContext();
    expect(createRes.status).toBe(201);
    const createdBody = await parse(createRes);
    const membershipId = createdBody?.data?.membershipId as string;

    // Patch (tenant-scoped audit)
    const h2 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-audit-update-2" });
    const patchReq = buildReq(`/api/admin/members/${membershipId}`, {
      method: "PATCH",
      headers: h2,
      cookies,
      body: json({ expectedVersion: 1, caps: { canManageProducts: true } }),
    });
    setNextRequestContextFromRequest(patchReq);
    const patchRes = await MemberPATCH(patchReq as any, { params: Promise.resolve({ id: membershipId }) });
    clearNextRequestContext();
    expect(patchRes.status).toBe(200);

    const row = await findAuditOne(
      { tenantId, action: "MEMBERSHIP_UPDATE", entityType: "Membership", entityId: membershipId },
      tenantId
    );
    expect(!!row).toBe(true);

    const diff = row!.diff as any;
    if (diff && typeof diff === "object") {
      expect("before" in diff).toBe(true);
      expect("after" in diff).toBe(true);
      // When detailed, we can assert version change and field name
      if (diff.before && typeof diff.before === "object" && diff.after && typeof diff.after === "object") {
        expect(diff.before.version).toBeDefined();
        expect(diff.after.version).toBeDefined();
        expect(diff.after.version).toBeGreaterThan(diff.before.version);
        expect(diff.after.canManageProducts).toBe(true);
      }
    } else {
      // Redacted string case
      expect(typeof diff).toBe("string");
      expect(String(diff)).toBeTruthy();
    }
  });

  test("MEMBERSHIP_DELETE writes a 'before' snapshot (redaction-aware)", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser();

    // Create a non-owner member to delete
    const h1 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-audit-delete-1" });
    const createReq = buildReq("/api/admin/members", {
      method: "POST",
      headers: h1,
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: true } }),
    });
    setNextRequestContextFromRequest(createReq);
    const createRes = await MembersPOST(createReq as any);
    clearNextRequestContext();
    expect(createRes.status).toBe(201);
    const createdBody = await parse(createRes);
    const membershipId = createdBody?.data?.membershipId as string;

    // Delete (tenant-scoped audit)
    const delReq = buildReq(`/api/admin/members/${membershipId}`, {
      method: "DELETE",
      headers: ctxHeaders(authHeaders),
      cookies,
    });
    setNextRequestContextFromRequest(delReq);
    const delRes = await MemberDELETE(delReq as any, { params: Promise.resolve({ id: membershipId }) });
    clearNextRequestContext();
    expect(delRes.status).toBe(200);

    const row = await findAuditOne(
      { tenantId, action: "MEMBERSHIP_DELETE", entityType: "Membership", entityId: membershipId },
      tenantId
    );
    expect(!!row).toBe(true);

    const diff = row!.diff as any;
    if (diff && typeof diff === "object") {
      expect("before" in diff).toBe(true);
    } else {
      expect(typeof diff).toBe("string");
      expect(String(diff)).toBeTruthy();
    }
  });

  test("Idempotent replay does not double-write MEMBERSHIP_CREATE", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser();
    const key = "mem-audit-idem-replay-1";

    // First create
    const req1 = buildReq("/api/admin/members", {
      method: "POST",
      headers: ctxHeaders(authHeaders, { "Idempotency-Key": key }),
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: true } }),
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await MembersPOST(req1 as any);
    clearNextRequestContext();
    expect(res1.status).toBe(201);
    const b1 = await parse(res1);
    const membershipId = b1?.data?.membershipId as string;

    // Replay with same key
    const req2 = buildReq("/api/admin/members", {
      method: "POST",
      headers: ctxHeaders(authHeaders, { "Idempotency-Key": key }),
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: false } }), // ignored on replay
    });
    setNextRequestContextFromRequest(req2);
    const res2 = await MembersPOST(req2 as any);
    clearNextRequestContext();
    expect(res2.status).toBe(201);

    const c = await countAudit(
      { tenantId, action: "MEMBERSHIP_CREATE", entityType: "Membership", entityId: membershipId },
      tenantId
    );
    expect(c).toBe(1);
  });
});
