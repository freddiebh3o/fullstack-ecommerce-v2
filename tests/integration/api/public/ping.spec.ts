// tests/integration/api/public/ping.spec.ts
import { describe, test, expect } from "vitest";
import "../../../_utils/next-auth.mock"; // harmless here, keeps env consistent with other suites
import { buildReq, parse } from "../../../_utils/http";
import { setNextRequestContextFromRequest, clearNextRequestContext } from "../../../_utils/next-context";
import { GET as PublicPingGET } from "@/app/api/public/ping/route";
import { mkTenant } from "../../../_utils/factories";
import { prisma } from "@/lib/db/prisma";
import { DomainStatus } from "@prisma/client";

// small helper to run the handler like Next would
async function hitPing(headers: Record<string,string>, cookies?: Record<string,string>) {
  const req = buildReq("/api/public/ping", { method: "GET", headers, cookies });
  setNextRequestContextFromRequest(req);
  const res = await PublicPingGET(req as any);
  clearNextRequestContext();
  const body = await parse(res);
  return { res, body };
}

describe("Public ping – host-gated 404s", () => {
  test("unknown host → 404 (no cookie fallback)", async () => {
    const { res, body } = await hitPing({ host: "no-such.example.test" });
    expect(res.status).toBe(404);
    expect(body?.ok).toBe(false);
  });

  test("unknown host + spoofed tenant_id cookie → still 404", async () => {
    const { res, body } = await hitPing(
      { host: "no-match.example.test" },
      { tenant_id: "00000000-0000-0000-0000-000000000000" }
    );
    expect(res.status).toBe(404);
    expect(body?.ok).toBe(false);
  });

  test("known/verified host → 200 and returns tenantId", async () => {
    const t = await mkTenant(); // creates a tenant in system DB
    const host = `shop-${Date.now()}.example.test`;

    // seed a verified domain for that tenant
    await prisma.domain.create({
      data: {
        tenantId: t.id,
        host,
        isPrimary: true,
        status: DomainStatus.VERIFIED,
      },
    });

    const { res, body } = await hitPing({ host });
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.data?.tenantId).toBe(t.id);
  });

  test("host wins over wrong cookie → 200 and correct tenantId", async () => {
    const t = await mkTenant();
    const host = `store-${Date.now()}.example.test`;

    await prisma.domain.create({
      data: {
        tenantId: t.id,
        host,
        isPrimary: true,
        status: DomainStatus.VERIFIED,
      },
    });

    const { res, body } = await hitPing(
      { host },
      { tenant_id: "11111111-1111-1111-1111-111111111111" } // wrong cookie, should be ignored for public
    );
    expect(res.status).toBe(200);
    expect(body?.ok).toBe(true);
    expect(body?.data?.tenantId).toBe(t.id);
  });
});
