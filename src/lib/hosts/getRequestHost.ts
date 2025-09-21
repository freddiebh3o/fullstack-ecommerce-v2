// src/lib/hosts/getRequestHost.ts
import { headers } from "next/headers";
import { normalizeHost } from "./normalizeHost";

// Next.js 15: headers() is async.
export async function getRequestHost(): Promise<string | null> {
  const h = await headers();

  const xfh = normalizeHost(h.get("x-forwarded-host"));
  if (xfh) return xfh;

  const host = normalizeHost(h.get("host"));
  if (host) return host;

  return null;
}
