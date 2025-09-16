// src/lib/core/tenant.ts
"use server";

import { cookies } from "next/headers";
import { prismaForTenant } from "@/lib/db/tenant-scoped";
import { TENANT_COOKIE } from "./constants";

export async function getCurrentTenantId(): Promise<string | null> {
  const jar = await cookies();
  return jar.get(TENANT_COOKIE)?.value ?? null;
}

export async function requireCurrentTenantId(): Promise<string> {
  const id = await getCurrentTenantId();
  if (!id) throw new Error("No tenant selected");
  return id;
}

export async function dbForCurrentTenantOrThrow() {
  const id = await requireCurrentTenantId();
  return prismaForTenant(id);
}
