// tests/_utils/next-context.ts
import { vi } from "vitest";

let _ctx: { headers?: Headers; cookieHeader?: string } = {};

export function setNextRequestContextFromRequest(req: Request) {
  _ctx.headers = req.headers;
  _ctx.cookieHeader = req.headers.get("cookie") || "";
}
export function clearNextRequestContext() { _ctx = {}; }

// NEW: allow other mocks (e.g., next-auth) to read current headers
export function getNextRequestHeaders(): Headers | undefined {
  return _ctx.headers;
}

function parseCookies(cookieHeader: string) {
  const map = new Map<string, string>();
  if (!cookieHeader) return map;
  for (const part of cookieHeader.split(";")) {
    const [k, v] = part.split("=").map((s) => s?.trim());
    if (k) map.set(k, decodeURIComponent(v ?? ""));
  }
  return map;
}

vi.mock("next/headers", () => {
  return {
    headers: () => _ctx.headers ?? new Headers(),
    cookies: () => {
      const jar = parseCookies(_ctx.cookieHeader || "");
      return {
        get: (name: string) => {
          const value = jar.get(name);
          return value ? { name, value } : undefined;
        },
        getAll: () => Array.from(jar.entries()).map(([name, value]) => ({ name, value })),
        set: (name: string, value: string) => { jar.set(name, value); },
        delete: (name: string) => { jar.delete(name); },
      };
    },
  };
});
