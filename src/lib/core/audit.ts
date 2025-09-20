// src/lib/core/audit.ts
import { loggerForRequest } from "@/lib/log/log";

type AuditInput = {
  tenantId: string;
  userId: string | null;
  action: string;
  entityType?: string | null;
  entityId?: string | null;
  diff?: unknown; // generic JSON; keep it small
  req: Request;
};

/**
 * Minimal shape we require from a DB client.
 * Works with both the raw PrismaClient and your $extends tenant client.
 */
type AuditDb = {
  auditLog: {
    /* eslint-disable @typescript-eslint/no-explicit-any */
    // Keep this intentionally 'any' so both PrismaClient and $extends clients are assignable.
    // Function parameter variance makes stricter types fail structural matching here.
    create: (...args: any[]) => Promise<any>;
    /* eslint-enable @typescript-eslint/no-explicit-any */
  };
};

/**
 * Shallow redaction of known secret-like fields inside an object.
 * Only traverses one level deep to keep it cheap and predictable.
 */
function redactOnce(obj: unknown): unknown {
  if (obj === null || typeof obj !== "object") return obj;
  const secrets = new Set(["password", "token", "secret", "authorization", "cookie", "csrf"]);

  if (Array.isArray(obj)) {
    // For arrays, just mask objects one level deep, pass primitives through
    return (obj as unknown[]).map((v) =>
      v && typeof v === "object" ? "[object]" : v
    );
  }

  const src = obj as Record<string, unknown>;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(src)) {
    if (secrets.has(k.toLowerCase())) {
      out[k] = "[REDACTED]";
    } else if (v !== null && typeof v === "object") {
      out[k] = "[object]";
    } else {
      out[k] = v;
    }
  }
  return out;
}

export async function writeAudit(db: AuditDb, input: AuditInput) {
  const { log } = loggerForRequest(input.req, { audit: true });
  try {
    await db.auditLog.create({
      data: {
        // tenantId will be auto-injected by the tenant-scoped client
        userId: input.userId ?? undefined,
        action: input.action,
        entityType: input.entityType ?? undefined,
        entityId: input.entityId ?? undefined,
        diff: input.diff ? redactOnce(input.diff) : undefined,
        ip:
          input.req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
          input.req.headers.get("x-real-ip") ||
          undefined,
        userAgent: input.req.headers.get("user-agent") || undefined,
      },
    });
    log.info({ event: "audit_write_ok", action: input.action });
  } catch (err) {
    log.error({ err, event: "audit_write_failed", action: input.action });
  }
}

/**
 * Helper to compute a tiny before/after diff for updated fields.
 */
export function diffForUpdate<T extends Record<string, unknown>>(
  before: T,
  after: T,
  changedKeys: (keyof T)[]
) {
  const pick = (obj: T): Partial<T> => {
      const acc: Partial<T> = {};
      for (const k of changedKeys) {
        acc[k] = obj[k];
      }
      return acc;
    };
  return { before: pick(before), after: pick(after) };
}
