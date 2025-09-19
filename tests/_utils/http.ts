// tests/_utils/http.ts
/**
 * Tiny HTTP harness for calling Next.js App Router handlers in tests.
 * Node 18+ provides WHATWG fetch/Request/Response globally.
 */

export const BASE_TEST_URL = process.env.NEXTAUTH_URL || "http://localhost:3000";

/** Build a Request for a route handler (e.g., POST handler in app/api/foo/route.ts) */
export function buildReq(
  path: string,
  opts: {
    method?: string;
    headers?: Record<string, string>;
    body?: BodyInit | null;
    cookies?: Record<string, string>;
  } = {},
): Request {
  const url = path.startsWith("http") ? path : `${BASE_TEST_URL}${path}`;
  const headers = new Headers(opts.headers ?? {});
  // Merge cookies into a single Cookie header if provided
  if (opts.cookies && Object.keys(opts.cookies).length > 0) {
    const cookieHeader = serializeCookies(opts.cookies);
    // Append/merge with any prior Cookie header
    const existing = headers.get("cookie");
    headers.set("cookie", existing ? `${existing}; ${cookieHeader}` : cookieHeader);
  }

  const init: RequestInit = {
    method: (opts.method ?? "GET").toUpperCase(),
    headers,
  };

  // Body must be undefined for GET/HEAD by spec; only attach when valid
  const methodAllowsBody = !["GET", "HEAD"].includes(String(init.method));
  if (methodAllowsBody && opts.body != null) {
    init.body = opts.body;
  }

  return new Request(url, init);
}

/** Helper: JSON stringify body and remember to set content-type in your test headers */
export function json(data: unknown): string {
  return JSON.stringify(data);
}

/** Helper: URL-encoded form body */
export function form(data: Record<string, string | number | boolean>): URLSearchParams {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries(data)) sp.set(k, String(v));
  return sp;
}

/** Helper: plain text body */
export function text(s: string): string {
  return s;
}

/** Parse JSON (falls back to text if not JSON) */
export async function parse(res: Response): Promise<any> {
  const ct = res.headers.get("content-type") || "";
  if (ct.includes("application/json")) {
    return res.json();
  }
  const t = await res.text();
  try {
    return JSON.parse(t);
  } catch {
    return t;
  }
}

/** Serialize cookies map -> Cookie header string */
export function serializeCookies(cookies: Record<string, string>): string {
  return Object.entries(cookies)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join("; ");
}

/** Convenience: merge headers objects (later wins) into a plain object */
export function mergeHeaders(
  ...parts: Array<Record<string, string> | undefined>
): Record<string, string> {
  const out: Record<string, string> = {};
  for (const p of parts) {
    if (!p) continue;
    for (const [k, v] of Object.entries(p)) out[k] = v;
  }
  return out;
}

/** Get a single Set-Cookie header value (if any). Note: multiple Set-Cookie may exist. */
export function getSetCookie(res: Response): string | null {
  // In undici/WHATWG, multiple Set-Cookie headers are concatenated; many runtimes expose only the last.
  // For robust multi-cookie parsing you might need a server harness. This is sufficient for most tests.
  return res.headers.get("set-cookie");
}

/** Type guards for your standard envelope */
export function isOkEnvelope<T = any>(x: any): x is { ok: true; data: T; requestId?: string } {
  return x && x.ok === true && "data" in x;
}
export function isErrorEnvelope(x: any): x is { ok: false; error: string; requestId?: string } {
  return x && x.ok === false && typeof x.error === "string";
}

export function callDynamicRoute<T extends Function>(
  handler: T,
  req: Request,
  params: Record<string, string>
) {
  return (handler as any)(req, { params: Promise.resolve(params) });
}