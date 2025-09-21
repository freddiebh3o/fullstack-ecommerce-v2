// src/lib/tenant/context.ts
import { AsyncLocalStorage } from "node:async_hooks";

export type TenantSource = "host" | "cookie" | "header" | "query" | null;

type Ctx = {
  tenantId?: string;
  source: TenantSource;
};

const als = new AsyncLocalStorage<Ctx>();

export function runWithTenantContext<T>(ctx: Ctx, fn: () => Promise<T> | T): Promise<T> | T {
  return als.run(ctx, fn);
}

export function getTenantContext(): Ctx {
  return als.getStore() ?? { tenantId: undefined, source: null };
}

export function getTenantId(): string | undefined {
  return getTenantContext().tenantId;
}
