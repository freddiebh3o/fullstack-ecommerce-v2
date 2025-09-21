// src/lib/http/canonical.ts
export type CanonicalParts = {
    protocol: "http" | "https";
    host: string;
    origin: string;
  };
  
  /** Resolve canonical origin for a request (works with raw Request or Headers) */
  export function canonicalFrom(input: Headers | Request): URL {
    // Normalize to Headers
    const h = "headers" in input ? input.headers : input;
  
    // 1) APP_BASE_URL wins
    const appBase = process.env.APP_BASE_URL?.trim();
    if (appBase) return new URL(appBase);
  
    // 2) X-Forwarded-* (take first if comma-separated)
    const xfProto = h.get("x-forwarded-proto")?.split(",")[0]?.trim();
    const xfHost  = h.get("x-forwarded-host")?.split(",")[0]?.trim();
    if (xfHost) {
      const proto = (xfProto || "https").trim();
      return new URL(`${proto}://${xfHost}`);
    }
  
    // 3) Fallback to Host; keep port
    const host = h.get("host") || "localhost";
    const isProd = process.env.NODE_ENV === "production";
    const proto = isProd ? "https" : "http";
    return new URL(`${proto}://${host}`);
  }
  