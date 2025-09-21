// tests/integration/tenant/resolve-by-host.spec.ts
import { describe, it, expect, beforeEach, afterEach } from "vitest";
import { sys, mkTenant } from "@/../tests/_utils/factories";
import { resolveTenantByHost, __clearResolveTenantCache } from "@/lib/tenant/resolveTenantByHost";
import { DomainStatus } from "@prisma/client";

let tenantA: string;
let tenantB: string;

async function seedTenantsAndDomains() {
  const ta = await mkTenant();
  const tb = await mkTenant();
  tenantA = ta.id;
  tenantB = tb.id;

  await sys.domain.upsert({
    where: { host: "a.example.test" },
    create: { tenantId: tenantA, host: "a.example.test", isPrimary: true, status: DomainStatus.VERIFIED },
    update: { tenantId: tenantA, isPrimary: true, status: DomainStatus.VERIFIED },
  });

  await sys.domain.upsert({
    where: { host: "b.example.test" },
    create: { tenantId: tenantB, host: "b.example.test", isPrimary: true, status: DomainStatus.PENDING },
    update: { tenantId: tenantB, isPrimary: true, status: DomainStatus.PENDING },
  });
}

beforeEach(async () => {
  __clearResolveTenantCache();      // avoid cached nulls
  await seedTenantsAndDomains();    // seed AFTER any global truncation
});

afterEach(async () => {
  // If you don’t have a global truncation hook, keep these:
  await sys.domain.deleteMany({ where: { host: { in: ["a.example.test", "b.example.test"] } } });
  await sys.tenant.deleteMany({ where: { id: { in: [tenantA, tenantB] } } });
});

describe("resolveTenantByHost", () => {
  it("returns tenant for verified host", async () => {
    const r = await resolveTenantByHost("A.Example.Test:443");
    expect(r).toEqual({ tenantId: tenantA, isPrimary: true });
  });

  it("returns null for pending host by default", async () => {
    const r = await resolveTenantByHost("b.example.test");
    expect(r).toBeNull();
  });

  it("can allow pending in dev if opted in", async () => {
    const r = await resolveTenantByHost("b.example.test", { allowPendingInDev: true });
    expect(r).toEqual({ tenantId: tenantB, isPrimary: true });
  });

  it("returns null for unknown hosts", async () => {
    const r = await resolveTenantByHost("unknown.test");
    expect(r).toBeNull();
  });
});
