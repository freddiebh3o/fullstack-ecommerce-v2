// tests/integration/api/members.create-and-list.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkUser, mkTenant, member, prismaForTenant } from "../../../_utils/factories";
import { POST as MembersPOST, GET as MembersGET } from "@/app/api/admin/members/route";

type MemberRow = {
  membershipId: string;
  userId: string;
  user?: { email?: string | null };
  caps: Record<string, unknown>;
  version: number;
  createdAt: string | Date;
  updatedAt: string | Date;
};

// helper to assemble auth+csrf headers for this request
function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair(); // fresh token each call
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Members – create & list & idempotency", () => {
  test("POST creates membership and idempotent replay returns same 201/body", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser(); // existing system user to add

    const headers1 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-create-idem-1" });
    const req1 = buildReq("/api/admin/members", {
      method: "POST",
      headers: headers1,
      cookies,
      body: json({
        email: target.email,
        caps: { canManageMembers: true, canManageProducts: false, canViewProducts: true, isOwner: false },
      }),
    });

    setNextRequestContextFromRequest(req1);
    const res1 = await MembersPOST(req1 as any);
    clearNextRequestContext();
    expect(res1.status).toBe(201);
    const body1 = await parse(res1);
    expect(body1?.ok).toBe(true);
    expect(body1?.data?.membershipId).toBeTruthy();
    expect(body1?.data?.user?.email).toBe(target.email);

    // replay with SAME key but different body → should return same 201 + same body
    const headers2 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-create-idem-1" });
    const req2 = buildReq("/api/admin/members", {
      method: "POST",
      headers: headers2,
      cookies,
      body: json({
        email: target.email,
        caps: { canManageMembers: false, canManageProducts: true, canViewProducts: false, isOwner: true }, // ignored on replay
      }),
    });

    setNextRequestContextFromRequest(req2);
    const res2 = await MembersPOST(req2 as any);
    clearNextRequestContext();
    expect(res2.status).toBe(res1.status);
    const body2 = await parse(res2);
    // Replay should return the same DATA payload (requestId may differ)
    expect(body2?.ok).toBe(true);
    expect(body2?.data).toStrictEqual(body1?.data);
    expect(body1?.requestId).toBeTruthy();
    expect(body2?.requestId).toBeTruthy();
    // It’s fine if requestId changes on replay
    // (stored data is wrapped by a fresh ok(..., req))
    if (body1?.requestId && body2?.requestId) {
      expect(body2.requestId === body1.requestId).toBe(false);
    }

    // DB sanity: only one membership for that user in this tenant
    const db = prismaForTenant(tenantId);
    const count = await db.membership.count({ where: { userId: target.id } });
    expect(count).toBe(1);
  });

  test("POST 404 when email not found", async () => {
    const { headers: authHeaders, cookies } = await withAuthAndTenant();

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-create-404" });
    const req = buildReq("/api/admin/members", {
      method: "POST",
      headers,
      cookies,
      body: json({
        email: "no-such-user@example.invalid",
        caps: { canManageMembers: false, canViewProducts: true },
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(404);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });

  test("POST duplicate membership (different Idempotency-Key) → 409", async () => {
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const target = await mkUser();

    // First create (201)
    const headers1 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-create-dup-1" });
    const req1 = buildReq("/api/admin/members", {
      method: "POST",
      headers: headers1,
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: true } }),
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await MembersPOST(req1 as any);
    clearNextRequestContext();
    expect([201]).toContain(res1.status);

    // Try again with a DIFFERENT key (not a replay) → should hit unique constraint → 409
    const headers2 = ctxHeaders(authHeaders, { "Idempotency-Key": "mem-create-dup-2" });
    const req2 = buildReq("/api/admin/members", {
      method: "POST",
      headers: headers2,
      cookies,
      body: json({ email: target.email, caps: { canViewProducts: true } }),
    });
    setNextRequestContextFromRequest(req2);
    const res2 = await MembersPOST(req2 as any);
    clearNextRequestContext();
    expect(res2.status).toBe(409);

    // Still only one membership
    const db = prismaForTenant(tenantId);
    const count = await db.membership.count({ where: { userId: target.id } });
    expect(count).toBe(1);
  });

  test("GET lists only current-tenant memberships with expected shape", async () => {
    // Tenant A (actor) and an extra member
    const { headers: authHeaders, cookies, tenantId } = await withAuthAndTenant();
    const extraUser = await mkUser();
    await member(extraUser.id, tenantId, { canViewProducts: true });

    // Tenant B with a member (should NOT appear)
    const tB = await mkTenant();
    const otherUser = await mkUser();
    await member(otherUser.id, tB.id, { canViewProducts: true });

    const headers = ctxHeaders(authHeaders);
    const req = buildReq("/api/admin/members", {
      method: "GET",
      headers,
      cookies,
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersGET(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);
    // Support both shapes: ok(data[]) vs ok({ data: data[] })
    const data = Array.isArray(body?.data) ? body.data : body?.data?.data;
    const rows: MemberRow[] = (data ?? []) as MemberRow[];
    expect(Array.isArray(rows)).toBe(true);
    // all rows belong to tenantId's memberships
    expect(rows.length).toBeGreaterThanOrEqual(2);
    for (const r of rows) {
      expect(r.membershipId).toBeTruthy();
      expect(r.userId).toBeTruthy();
      expect(r.user?.email).toBeTruthy();
      expect(r.caps).toBeTruthy();
      expect(typeof r.version).toBe("number");
      expect(r.createdAt).toBeTruthy();
      expect(r.updatedAt).toBeTruthy();
    }

    // ensure the Tenant B member is NOT present
    const hasOther = rows.some((r) => r.userId === otherUser.id);
    expect(hasOther).toBe(false);
  });
});
