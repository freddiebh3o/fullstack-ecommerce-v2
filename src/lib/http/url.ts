// src/lib/http/url.ts
import { canonicalFrom } from "./canonical";

export function absoluteUrl(
  reqOrHeaders: Request | Headers,
  path = "/",
  q?: Record<string, string | number | boolean | undefined | null>
) {
  const { origin } = canonicalFrom(reqOrHeaders);
  const u = new URL(path.startsWith("/") ? path : `/${path}`, origin);
  if (q) {
    Object.entries(q)
      .filter(([, v]) => v !== undefined && v !== null)
      .forEach(([k, v]) => u.searchParams.set(k, String(v)));
  }
  return u.toString();
}

export function joinPath(...parts: (string | undefined | null)[]) {
  return parts
    .filter(Boolean)
    .map((s) => s!.replace(/(^\/+|\/+$)/g, ""))
    .join("/")
    .replace(/^/, "/"); // ensure leading slash
}

export function withQuery(
  urlOrPath: string,
  q: Record<string, string | number | boolean | undefined | null>
) {
  const base = urlOrPath.startsWith("http")
    ? new URL(urlOrPath)
    : new URL(urlOrPath, "http://local");
  Object.entries(q)
    .filter(([, v]) => v !== undefined && v !== null)
    .forEach(([k, v]) => base.searchParams.set(k, String(v)));
  // If we used the dummy base, return path+query; otherwise full URL
  return urlOrPath.startsWith("http")
    ? base.toString()
    : base.pathname + base.search;
}
