// tests/integration/api/members.occ-and-guards.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { withAuthAndTenant } from "../../../_utils/auth";
import { csrfPair } from "../../../_utils/csrf";
import { prismaForTenant, mkTenant, mkUser, member } from "../../../_utils/factories";
import { PATCH as MemberPATCH } from "@/app/api/admin/members/[id]/route";

// helper to assemble auth+csrf headers for this request
function ctxHeaders(auth: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair(); // fresh token each call
  return mergeHeaders(auth, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Members – OCC & route guards", () => {
  test("PATCH OCC: successful change bumps version by 1", async () => {
    // Actor: owner (canManageMembers) from our helper
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // Target: the actor's own membership (owner)
    const me = await db.membership.findFirstOrThrow({ where: { userId } });
    expect(me.version).toBe(1);

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "m-occs-ok-1" });
    const req = buildReq(`/api/admin/members/${me.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, caps: { canManageProducts: !me.canManageProducts } }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberPATCH(req as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(200);
    const body = await parse(res);
    expect(body?.ok).toBe(true);

    const after = await db.membership.findFirstOrThrow({ where: { id: me.id } });
    expect(after.version).toBe(2);
    expect(after.canManageProducts).toBe(!me.canManageProducts);
  });

  test("PATCH OCC: stale expectedVersion → 409 with { expectedVersion, currentVersion }", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    const me = await db.membership.findFirstOrThrow({ where: { userId } });
    expect(me.version).toBe(1);

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "m-occs-stale-1" });
    const req = buildReq(`/api/admin/members/${me.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 999, caps: { canViewProducts: !me.canViewProducts } }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberPATCH(req as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(409);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(body?.error).toMatch(/version/i);
    expect(body?.currentVersion).toBeDefined();
    expect(typeof body?.currentVersion).toBe("number");
    expect(body.currentVersion).toBeGreaterThanOrEqual(1);
    expect(body.expectedVersion).toBe(999); // optional sanity check
  });

  test("Guard: cannot demote the last owner", async () => {
    const { headers: authHeaders, cookies, tenantId, userId } = await withAuthAndTenant();
    const db = prismaForTenant(tenantId);

    // Only one owner exists (the actor). Try to demote self → should be blocked by route guard.
    const me = await db.membership.findFirstOrThrow({ where: { userId } });
    expect(me.isOwner).toBe(true);

    const headers = ctxHeaders(authHeaders, { "Idempotency-Key": "m-guard-last-owner-1" });
    const req = buildReq(`/api/admin/members/${me.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: me.version, caps: { isOwner: false } }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberPATCH(req as any, { params: Promise.resolve({ id: me.id }) });
    clearNextRequestContext();

    // Guard should block: typically 409 (business conflict) or 400/403 depending on your implementation.
    expect([409, 400, 403]).toContain(res.status);

    const ownersAfter = await db.membership.count({ where: { isOwner: true } });
    expect(ownersAfter).toBe(1); // still exactly one owner
  });

  test("Guard: non-owner cannot set isOwner (owners-only rule)", async () => {
    // Build tenant with two members:
    // - Alice: owner
    // - Bob: manager (canManageMembers: true) but NOT owner
    const t = await mkTenant();
    const alice = await mkUser();
    const bob = await mkUser();

    // memberships
    await member(alice.id, t.id, { isOwner: true, canManageMembers: true });
    const bobM = await member(bob.id, t.id, { isOwner: false, canManageMembers: true });

    // Actor session is Bob (manager but not owner)
    const { headers: csrfHeaders } = csrfPair();
    const headers = mergeHeaders(
      {
        "x-test-user-id": bob.id,
        "x-test-user-email": bob.email ?? "bob@example.com",
        "content-type": "application/json",
        "Idempotency-Key": "m-guard-owner-flag-1",
      },
      csrfHeaders
    );
    const cookies = { tenant_id: t.id };

    // Bob attempts to grant himself owner → should be 403 (owners-only)
    const req = buildReq(`/api/admin/members/${bobM.id}`, {
      method: "PATCH",
      headers,
      cookies,
      body: json({ expectedVersion: 1, caps: { isOwner: true } }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MemberPATCH(req as any, { params: Promise.resolve({ id: bobM.id }) });
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    // confirm DB unchanged
    const after = await prismaForTenant(t.id).membership.findFirstOrThrow({ where: { id: bobM.id } });
    expect(after.isOwner).toBe(false);
    expect(after.version).toBe(1);
  });
});
