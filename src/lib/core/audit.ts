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
    create: (args: { data: any }) => Promise<any>;
  };
};

/**
 * Shallow redaction of known secret-like fields inside an object.
 * Only traverses one level deep to keep it cheap and predictable.
 */
function redactOnce(obj: any): any {
  if (!obj || typeof obj !== "object") return obj;
  const secrets = new Set(["password", "token", "secret", "authorization", "cookie", "csrf"]);
  const out: Record<string, any> = Array.isArray(obj) ? ([] as any) : {};
  for (const [k, v] of Object.entries(obj)) {
    if (secrets.has(k.toLowerCase())) {
      (out as any)[k] = "[REDACTED]";
    } else if (v && typeof v === "object") {
      (out as any)[k] = "[object]";
    } else {
      (out as any)[k] = v;
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
export function diffForUpdate<T extends Record<string, any>>(
  before: T,
  after: T,
  changedKeys: (keyof T)[]
) {
  const pick = (obj: T) =>
    changedKeys.reduce((acc, k) => {
      (acc as any)[k as string] = obj[k];
      return acc;
    }, {} as Partial<T>);
  return { before: pick(before), after: pick(after) };
}
