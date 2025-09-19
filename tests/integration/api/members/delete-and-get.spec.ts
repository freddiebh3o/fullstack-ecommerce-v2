// tests/integration/api/members.delete-and-get.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member, prismaForTenant } from "../../../_utils/factories";
import { DELETE as MemberDELETE, GET as MemberGET } from "@/app/api/admin/members/[id]/route";

function withCsrf(h: Record<string,string>, extra?: Record<string,string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(h, csrfHeaders, extra);
}

describe("Members – DELETE & GET", () => {
  test("DELETE blocks removing the last owner", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const me = await db.membership.findFirstOrThrow({ where: { userId } });

    const headers = withCsrf(authHeaders, { "Idempotency-Key": "mem-del-last-owner-1" });
    const req = buildReq(`/api/admin/members/${me.id}`, {
      method: "DELETE",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberDELETE(req as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    // Business guard should prevent deleting the sole owner
    expect([409, 400, 403]).toContain(res.status);
    const stillOwners = await db.membership.count({ where: { isOwner: true } });
    expect(stillOwners).toBe(1);
  });

  test("DELETE succeeds when not the last owner and writes audit", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // Add a second owner so removing one is allowed
    const other = await mkUser();
    await member(other.id, tenantId, { isOwner: true, canManageMembers: true });

    // Delete the original owner membership
    const target = await db.membership.findFirstOrThrow({ where: { userId } });

    const headers = withCsrf(authHeaders, { "Idempotency-Key": "mem-del-ok-1" });
    const req = buildReq(`/api/admin/members/${target.id}`, {
      method: "DELETE",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberDELETE(req as any, { params: Promise.resolve({ id: target.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const exists = await db.membership.findFirst({ where: { id: target.id } });
    expect(exists).toBeNull();

    // optional: audit sanity (one delete entry)
    const audits = await db.auditLog.findMany({ where: { action: "MEMBERSHIP_DELETE", entityId: target.id } });
    expect(audits.length).toBe(1);
  });

  test("GET /api/admin/members/[id] returns expected shape for managers", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const anyMember = await db.membership.findFirstOrThrow();

    const headers = withCsrf(authHeaders);
    const req = buildReq(`/api/admin/members/${anyMember.id}`, {
      method: "GET",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberGET(req as any, { params: Promise.resolve({ id: anyMember.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const d = body.data;
    expect(d.membershipId).toBeTruthy();
    expect(d.userId).toBeTruthy();
    expect(d.user?.email).toBeTruthy();
    expect(d.caps).toBeTruthy();
    expect(typeof d.version).toBe("number");
    expect(d.createdAt).toBeTruthy();
    expect(d.updatedAt).toBeTruthy();
  });

  test("GET is 403 for non-managers", async () => {
    // Build a tenant with an owner (manager) and a non-manager
    const t = await mkTenant();
    const owner = await mkUser();
    const viewer = await mkUser();

    await member(owner.id, t.id, { isOwner: true, canManageMembers: true });
    const viewerMem = await member(viewer.id, t.id, { canManageMembers: false, canViewProducts: true });

    // Act as the viewer (no manage-members permission)
    const { headers: csrfHeaders } = csrfPair();
    const headers = mergeHeaders(
      { "x-test-user-id": viewer.id, "x-test-user-email": viewer.email ?? "viewer@example.com" },
      csrfHeaders
    );
    const cookies = { tenant_id: t.id };

    const req = buildReq(`/api/admin/members/${viewerMem.id}`, {
      method: "GET",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberGET(req as any, { params: Promise.resolve({ id: viewerMem.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });
});
