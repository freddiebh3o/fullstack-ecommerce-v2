// src/lib/security/rate-limit.ts
// Minimal in-memory fixed-window rate limiter (dev-friendly).
// Later we can swap to Redis with the same shape if REDIS_URL exists.

type Bucket = { count: number; resetAt: number };
const store = new Map<string, Bucket>();

export type RateStats = {
  ok: boolean;
  limit: number;
  remaining: number;
  retryAfter?: number; // seconds
  resetAt: number;     // epoch ms
};

function keyOf(parts: (string | number | undefined | null)[]) {
  return parts.filter(Boolean).join("|");
}

export function ipFromRequest(req: Request): string {
  const xf = req.headers.get("x-forwarded-for");
  if (xf) return xf.split(",")[0]!.trim();
  const xr = req.headers.get("x-real-ip");
  if (xr) return xr;
  // Node dev / local fallback
  return "127.0.0.1";
}

/**
 * Increment the bucket for the given key inside a fixed window.
 * Returns stats including remaining and retryAfter on denial.
 */
export function rateLimitFixedWindow(params: {
  key: string;
  limit: number;
  windowMs: number;
}): RateStats {
  const { key, limit, windowMs } = params;
  const now = Date.now();

  let b = store.get(key);
  if (!b || b.resetAt <= now) {
    b = { count: 0, resetAt: now + windowMs };
    store.set(key, b);
  }

  if (b.count >= limit) {
    const retryAfterSec = Math.max(1, Math.ceil((b.resetAt - now) / 1000));
    return {
      ok: false,
      limit,
      remaining: 0,
      retryAfter: retryAfterSec,
      resetAt: b.resetAt,
    };
  }

  b.count += 1;
  return {
    ok: true,
    limit,
    remaining: Math.max(0, limit - b.count),
    resetAt: b.resetAt,
  };
}
