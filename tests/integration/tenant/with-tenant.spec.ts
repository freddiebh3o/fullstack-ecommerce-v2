import { describe, it, expect, beforeEach } from "vitest";
import { resolveTenantByHost, __clearResolveTenantCache } from "@/lib/tenant/resolveTenantByHost";
import { normalizeHost } from "@/lib/hosts/normalizeHost";
import { sys, mkTenant } from "@/../tests/_utils/factories";
import { DomainStatus } from "@prisma/client";

beforeEach(async () => {
  __clearResolveTenantCache();
  await sys.$executeRawUnsafe(`TRUNCATE TABLE "Domain","Tenant" RESTART IDENTITY CASCADE;`);
});

describe("policy basics (resolver already tested)", () => {
  it("host wins over cookie (conceptual)", async () => {
    const t = await mkTenant();
    await sys.domain.create({
      data: { tenantId: t.id, host: "x.example.test", isPrimary: true, status: DomainStatus.VERIFIED },
    });
    // This spec just sanity-checks normalize + resolver combo:
    const host = normalizeHost("X.Example.Test:443");
    const r = await resolveTenantByHost(host);
    expect(r?.tenantId).toBe(t.id);
  });
});
