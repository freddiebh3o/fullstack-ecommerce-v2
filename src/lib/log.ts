// src/lib/log.ts
import pino from "pino";

// Narrow type we use when binding request info
export type RequestMeta = {
  requestId: string;
  method: string;
  path: string;
  ip?: string | null;
  userAgent?: string | null;
};

function pickIp(headers: Headers): string | null {
  const xff = headers.get("x-forwarded-for");
  if (xff) {
    const first = xff.split(",")[0]?.trim();
    if (first) return first;
  }
  return headers.get("x-real-ip") || null;
}

export function getOrCreateRequestId(headers: Headers): string {
  return (
    headers.get("x-request-id") ||
    headers.get("x-correlation-id") ||
    // Next.js edge/runtime provides crypto.randomUUID
    (typeof crypto !== "undefined" && "randomUUID" in crypto
      ? (crypto as any).randomUUID()
      : Math.random().toString(36).slice(2))
  );
}

// Base logger (JSON). Pretty printing can be added in deployment tooling.
export const logger = pino({
  level: process.env.LOG_LEVEL || "info",
  redact: {
    paths: [
      "req.headers.authorization",
      "req.headers.cookie",
      'req.headers["x-csrf-token"]',
      "headers.authorization",
      "headers.cookie",
      'headers["x-csrf-token"]',
    ],
    censor: "[REDACTED]",
  },
});

/**
 * Create a child logger bound to request metadata.
 */
export function loggerForRequest(req: Request, extra?: Record<string, unknown>) {
  const requestId = getOrCreateRequestId(req.headers);
  const url = new URL(req.url);
  const meta: RequestMeta = {
    requestId,
    method: req.method,
    path: url.pathname,
    ip: pickIp(req.headers),
    userAgent: req.headers.get("user-agent"),
  };
  return {
    requestId,
    meta,
    log: logger.child({ ...meta, ...(extra ?? {}) }),
  };
}
