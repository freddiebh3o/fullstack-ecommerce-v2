import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock";
import { buildReq, mergeHeaders, parse } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { csrfPair } from "../../../_utils/csrf";
import { mkTenant, mkUser, member } from "../../../_utils/factories";
import { GET as MembersGET } from "@/app/api/admin/members/route";

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

describe("Members – list guards", () => {
  test("GET /api/admin/members is 403 for non-managers", async () => {
    const t = await mkTenant();
    const owner = await mkUser();
    const viewer = await mkUser();

    await member(owner.id, t.id, { isOwner: true, canManageMembers: true });
    await member(viewer.id, t.id, { isOwner: false, canManageMembers: false, canViewProducts: true });

    const headers = headersFor(viewer);
    const cookies = { tenant_id: t.id };

    const req = buildReq("/api/admin/members", { method: "GET", headers, cookies });
    setNextRequestContextFromRequest(req);
    const res = await MembersGET(req as any);
    clearNextRequestContext();

    expect(res.status).toBe(403);
    const body = await parse(res);
    expect(body?.ok).toBe(false);
  });
});
