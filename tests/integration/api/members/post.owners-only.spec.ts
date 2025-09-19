// tests/integration/api/members.post.owners-only.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, json, parse, mergeHeaders } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member } from "../../../_utils/factories";
import { POST as MembersPOST } from "@/app/api/admin/members/route";

function ctxHeaders(base: Record<string, string>, extra?: Record<string, string>) {
  const { headers: csrfHeaders } = csrfPair();
  return mergeHeaders(base, csrfHeaders, { "content-type": "application/json" }, extra);
}

describe("Members – POST owners-only rule", () => {
  test("non-owner manager cannot create member with isOwner: true (403)", async () => {
    const t = await mkTenant();
    const owner = await mkUser();
    const manager = await mkUser();
    const target = await mkUser();

    // seed memberships
    await member(owner.id, t.id, { isOwner: true,  canManageMembers: true });
    await member(manager.id, t.id, { isOwner: false, canManageMembers: true });

    const headers = ctxHeaders({
      "x-test-user-id": manager.id,
      "x-test-user-email": manager.email ?? "manager@example.com",
      "Idempotency-Key": "mem-post-owneronly-1",
    });
    const cookies = { tenant_id: t.id };

    const req = buildReq("/api/admin/members", {
      method: "POST",
      headers,
      cookies,
      body: json({
        email: target.email,
        caps: { canViewProducts: true, canManageMembers: true, isOwner: true },
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
    expect(String(body?.error || "")).toMatch(/owner/i); // "Only owners can set isOwner"
  });

  test("owner can create member with isOwner: true (201)", async () => {
    const t = await mkTenant();
    const owner = await mkUser();
    const target = await mkUser();

    // seed owner membership for the actor
    await member(owner.id, t.id, { isOwner: true, canManageMembers: true });

    const headers = ctxHeaders({
      "x-test-user-id": owner.id,
      "x-test-user-email": owner.email ?? "owner@example.com",
      "Idempotency-Key": "mem-post-owneronly-2",
    });
    const cookies = { tenant_id: t.id };

    const req = buildReq("/api/admin/members", {
      method: "POST",
      headers,
      cookies,
      body: json({
        email: target.email,
        caps: { canViewProducts: true, isOwner: true },
      }),
    });

    setNextRequestContextFromRequest(req);
    const res = await MembersPOST(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(201);
    const body = await parse(res);
    expect(body?.ok).toBe(true);
    expect(body?.data?.user?.email).toBe(target.email);
    expect(body?.data?.caps?.isOwner).toBe(true);
  });
});
