// src/lib/security/idempotency.ts
import { systemDb } from "@/lib/db/system";

const IDEMPOTENCY_HEADER = "idempotency-key";

// Extract and sanity-check header. Return null if not present.
export function getIdempotencyKey(req: Request): string | null {
  const key = req.headers.get(IDEMPOTENCY_HEADER);
  if (!key) return null;
  const trimmed = key.trim();
  if (!trimmed) return null;
  if (trimmed.length > 200) {
    throw new Error("Idempotency-Key too long");
  }
  return trimmed;
}

type Fingerprint = {
  key: string;
  method: string;
  path: string;
  userId: string | null;
  tenantId: string | null;
};

function fpFrom(req: Request, key: string, userId?: string | null, tenantId?: string | null): Fingerprint {
  const url = new URL(req.url);
  return {
    key,
    method: req.method.toUpperCase(),
    path: url.pathname, // exclude query-string from the fingerprint
    userId: userId ?? null,
    tenantId: tenantId ?? null,
  };
}

export type ReserveOutcome =
  | { mode: "none" } // no idempotency requested
  | { mode: "replay"; statusCode: number; response: unknown }
  | { mode: "reserved"; fp: Fingerprint }
  | { mode: "in_progress" };

/**
 * Reserve an idempotency slot for (key, method, path, userId, tenantId).
 * - If an entry with a stored success response already exists => return "replay"
 * - If no entry, create a pending row => "reserved"
 * - If an entry exists but without stored response => "in_progress"
 */
export async function reserveIdempotency(
  req: Request,
  userId?: string | null,
  tenantId?: string | null
): Promise<ReserveOutcome> {
  const key = getIdempotencyKey(req);
  if (!key) return { mode: "none" };
  const fp = fpFrom(req, key, userId, tenantId);

  // Try to find existing (use filters with equals to allow string|null)
  const existing = await systemDb.idempotencyKey.findFirst({
    where: {
      key: fp.key,
      method: fp.method,
      path: fp.path,
      userId: { equals: fp.userId },
      tenantId: { equals: fp.tenantId },
    },
    select: { statusCode: true, response: true },
  });

  if (existing) {
    if (existing.statusCode && existing.response !== null) {
      return { mode: "replay", statusCode: existing.statusCode, response: existing.response as unknown };
    }
    return { mode: "in_progress" };
  }

  // Create a pending row. If a concurrent request wins, we’ll see it below as in_progress.
  try {
    await systemDb.idempotencyKey.create({
      data: {
        key: fp.key,
        method: fp.method,
        path: fp.path,
        userId: fp.userId,     // nullable ok
        tenantId: fp.tenantId, // nullable ok
      },
      select: { id: true },
    });
    return { mode: "reserved", fp };
  } catch {
    // Likely a unique race; re-check
    const after = await systemDb.idempotencyKey.findFirst({
      where: {
        key: fp.key,
        method: fp.method,
        path: fp.path,
        userId: { equals: fp.userId },
        tenantId: { equals: fp.tenantId },
      },
      select: { statusCode: true, response: true },
    });
    if (after?.statusCode && after.response !== null) {
      return { mode: "replay", statusCode: after.statusCode, response: after.response as unknown };
    }
    return { mode: "in_progress" };
  }
}

/** Persist the successful JSON result for a reserved key. Only store 2xx results. */
export async function persistIdempotentSuccess(
  fp: Fingerprint,
  statusCode: number,
  responseData: unknown
): Promise<void> {
  if (statusCode < 200 || statusCode >= 300) return;
  await systemDb.idempotencyKey.updateMany({
    where: {
      key: fp.key,
      method: fp.method,
      path: fp.path,
      userId: { equals: fp.userId },
      tenantId: { equals: fp.tenantId },
    },
    data: {
      statusCode,
      response: responseData as any,
    },
  });
}
