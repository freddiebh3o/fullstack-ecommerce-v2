// tests/unit/tenant/resolveTenantByHost.spec.ts
import { describe, it, expect, vi, beforeEach } from "vitest";
import { resolveTenantByHost, __clearResolveTenantCache } from "@/lib/tenant/resolveTenantByHost";
import { prisma } from "@/lib/db/prisma";
import { DomainStatus } from "@prisma/client";

vi.mock("@/lib/db/prisma", () => ({
  prisma: { domain: { findFirst: vi.fn() } }
}));

describe("resolveTenantByHost", () => {
  beforeEach(() => { __clearResolveTenantCache(); vi.resetAllMocks(); });

  it("returns null for unknown host", async () => {
    (prisma.domain.findFirst as any).mockResolvedValue(null);
    const r = await resolveTenantByHost("unknown.example.com");
    expect(r).toBeNull();
  });

  it("requires VERIFIED in prod", async () => {
    vi.stubEnv("NODE_ENV", "production");
    (prisma.domain.findFirst as any).mockResolvedValue({ tenantId: "t1", isPrimary: true, status: DomainStatus.PENDING });
    const r = await resolveTenantByHost("pending.example.com");
    expect(r).toBeNull();
  });

  it("allows pending in dev when enabled", async () => {
    vi.stubEnv("NODE_ENV", "development");
    (prisma.domain.findFirst as any).mockResolvedValue({ tenantId: "t1", isPrimary: true, status: DomainStatus.PENDING });
    const r = await resolveTenantByHost("pending.example.com", { allowPendingInDev: true });
    expect(r).toEqual({ tenantId: "t1", isPrimary: true });
  });
});
