// src/lib/security/origin.ts
// src/lib/security/origin.ts
// Strict origin validation for non-GET requests.
// Policy:
// - Allow GET/HEAD/OPTIONS without checks.
// - For other methods, require EITHER a valid Origin OR a valid Referer.
// - If both are missing => deny (unless explicitly allowed via env for local tooling).

type Check = { ok: true } | { ok: false; error: string };

const SAFE_METHODS = new Set(["GET", "HEAD", "OPTIONS"]);

function parseAllowedOrigins(): URL[] {
  const listFromEnv = (process.env.ORIGIN_ALLOW_LIST || "")
    .split(",")
    .map((s) => s.trim())
    .filter(Boolean);

  const fallbacks = [
    process.env.APP_URL,
    process.env.NEXTAUTH_URL,
    process.env.NEXT_PUBLIC_APP_URL,
  ].filter(Boolean) as string[];

  const devDefaults =
    process.env.NODE_ENV !== "production"
      ? ["http://localhost:3000", "http://127.0.0.1:3000"]
      : [];

  const all = [...listFromEnv, ...fallbacks, ...devDefaults];
  const uniq = Array.from(new Set(all));

  return uniq
    .map((s) => {
      try {
        return new URL(s);
      } catch {
        return null;
      }
    })
    .filter((u): u is URL => !!u);
}

function matchesAllowed(urlStr: string | null, allowed: URL[]): boolean {
  if (!urlStr) return false;
  try {
    const u = new URL(urlStr);
    return allowed.some((a) => a.protocol === u.protocol && a.host === u.host);
  } catch {
    return false;
  }
}

export function verifyOriginStrict(req: Request): Check {
  const method = req.method.toUpperCase();
  console.log("method1234", method);
  if (SAFE_METHODS.has(method)) return { ok: true };

  const allowed = parseAllowedOrigins();
  const origin = req.headers.get("origin");
  console.log("origin1234", origin);
  const referer = req.headers.get("referer");
  console.log("referer1234", referer);
  const ua = req.headers.get("user-agent") || "";

  // 1) If Origin present, it must match
  if (origin) {
    return matchesAllowed(origin, allowed)
      ? { ok: true }
      : { ok: false, error: "Invalid Origin" };
  }

  // 2) If no Origin, fall back to Referer (must match)
  if (referer) {
    return matchesAllowed(referer, allowed)
      ? { ok: true }
      : { ok: false, error: "Invalid Referer" };
  }

  // 3) Neither present -> deny (optionally allow for dev tooling)
  // const allowMissing =
  //   process.env.ALLOW_MISSING_ORIGIN === "true" ||
  //   /PostmanRuntime|insomnia/i.test(ua);
  const allowMissing =
    (process.env.ALLOW_MISSING_ORIGIN || "").toLowerCase() === "true";
  if (allowMissing) return { ok: true };

  console.log("allowMissing1234", allowMissing);

  if (allowMissing) return { ok: true };

  return { ok: false, error: "Missing Origin/Referer" };
}
