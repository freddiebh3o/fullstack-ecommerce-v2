import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member, prismaForTenant } from "../../../_utils/factories";
import { PATCH as MemberPATCH } from "@/app/api/admin/members/[id]/route";
import { POST as MembersPOST } from "@/app/api/admin/members/route";

function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Members – PATCH idempotency + POST owners-only", () => {
  test("PATCH idempotency: replay returns same data and does not double-apply", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const me = await db.membership.findFirstOrThrow({ where: { userId } });
    expect(me.version).toBe(1);

    const key = "m-patch-idem-1";
    const headers1 = ctxHeaders(authHeaders, { "Idempotency-Key": key });

    // First PATCH – toggle canViewProducts
    const req1 = buildReq(`/api/admin/members/${me.id}`, {
      method: "PATCH",
      headers: headers1,
      cookies,
      body: json({ expectedVersion: 1, caps: { canViewProducts: !me.canViewProducts } }),
    });
    setNextRequestContextFromRequest(req1);
    const res1 = await MemberPATCH(req1 as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    expect(res1.status).toBe(200);
    const body1 = await parse(res1);
    expect(body1?.ok).toBe(true);
    const after1 = await db.membership.findFirstOrThrow({ where: { id: me.id } });
    expect(after1.version).toBe(2);
    expect(after1.canViewProducts).toBe(!me.canViewProducts);

    // Replay with SAME key but different payload → should return same DATA as first,
    // and DB should remain unchanged (no extra version bump).
    const headers2 = ctxHeaders(authHeaders, { "Idempotency-Key": key });
    const req2 = buildReq(`/api/admin/members/${me.id}`, {
      method: "PATCH",
      headers: headers2,
      cookies,
      body: json({ expectedVersion: 999, caps: { canViewProducts: me.canViewProducts } }), // ignored on replay
    });
    setNextRequestContextFromRequest(req2);
    const res2 = await MemberPATCH(req2 as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    expect(res2.status).toBe(200);
    const body2 = await parse(res2);
    expect(body2?.ok).toBe(true);
    // replay returns same DATA payload (requestId may differ)
    expect(body2?.data).toStrictEqual(body1?.data);

    const after2 = await db.membership.findFirstOrThrow({ where: { id: me.id } });
    expect(after2.version).toBe(2); // no double-apply
    expect(after2.canViewProducts).toBe(!me.canViewProducts); // unchanged from first patch
  });

  test("POST owners-only: non-owner cannot create member with isOwner: true", async () => {
    // Tenant with:
    //  - Alice owner (so we can add a manager Bob)
    //  - Bob manager (canManageMembers: true) but NOT owner
    const t = await mkTenant();
    const alice = await mkUser();
    const bob = await mkUser();
    await member(alice.id, t.id, { isOwner: true, canManageMembers: true });
    await member(bob.id, t.id, { isOwner: false, canManageMembers: true });

    // Bob (not owner) tries to add Charlie with isOwner: true → should be 403
    const charlie = await mkUser();

    const { headers: csrfHeaders } = csrfPair();
    const headers = mergeHeaders(
      {
        "x-test-user-id": bob.id,
        "x-test-user-email": bob.email ?? "bob@example.com",
        "content-type": "application/json",
        "Idempotency-Key": "m-post-owner-flag-1",
      },
      csrfHeaders
    );
    const cookies = { tenant_id: t.id };

    const req = buildReq("/api/admin/members", {
      method: "POST",
      headers,
      cookies,
      body: json({
        email: charlie.email,
        caps: { isOwner: true, canManageMembers: true, canViewProducts: true },
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);

    // DB sanity: no membership created for Charlie in this tenant
    const db = prismaForTenant(t.id);
    const exists = await db.membership.findFirst({ where: { userId: charlie.id } });
    expect(exists).toBeNull();
  });
});
