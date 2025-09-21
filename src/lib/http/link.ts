// src/lib/http/link.ts
import { absoluteUrl } from "./url";

export function link(reqOrHeaders: Request | Headers, path: string, q?: Record<string, string | number | boolean | undefined | null>) {
  return absoluteUrl(reqOrHeaders, path, q);
}
