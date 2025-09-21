// src/lib/hosts/normalizeHost.ts
// Normalize an incoming Host/X-Forwarded-Host to a canonical host string.
// - lowercases
// - strips port
// - strips leading "www."
// - trims whitespace
export function normalizeHost(raw: string | null | undefined): string | null {
  if (!raw) return null;

  // prefer first value if comma-separated (some proxies)
  const first = raw.split(",")[0]?.trim();
  if (!first) return null;

  // strip port if present
  const withoutPort = first.replace(/:\d+$/, "");

  // lowercase and strip leading www.
  const lowered = withoutPort.toLowerCase();
  const noWww = lowered.startsWith("www.") ? lowered.slice(4) : lowered;

  // final quick sanity: must contain at least one dot or be a localhost-like token
  const looksLikeHost =
    noWww === "localhost" ||
    /^[a-z0-9.-]+\.[a-z0-9-]+$/.test(noWww) || // domain.tld or sub.domain.tld
    /^[0-9.]+$/.test(noWww); // raw IP

  return looksLikeHost ? noWww : null;
}
