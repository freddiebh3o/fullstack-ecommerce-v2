// src/lib/utils/prisma-errors.ts
import { Prisma } from "@prisma/client";

// Narrowing helper
export function isPrismaKnownError(
  e: unknown
): e is Prisma.PrismaClientKnownRequestError {
  return !!e && typeof e === "object" && "code" in (e as any);
}

// Keep your existing helper (routes may still use it)
export function isUniqueViolation(
  e: unknown,
  constraintNames?: string[]
): boolean {
  if (!isPrismaKnownError(e)) return false;
  if (e.code !== "P2002") return false;

  if (!constraintNames || constraintNames.length === 0) return true;

  const metaTarget = (e as any).meta?.target as string[] | string | undefined;
  const targets = Array.isArray(metaTarget) ? metaTarget : metaTarget ? [metaTarget] : [];
  const joined = targets.join(",");
  return constraintNames.some((c) => joined.includes(c));
}

/**
 * Central mapping: Prisma error -> { status, message, details? }
 * Keep messages short & generic; attach `code`/`meta` in details for logs.
 */
export function mapPrismaError(e: unknown):
  | { status: number; message: string; details?: Record<string, unknown> }
  | null {
  if (!isPrismaKnownError(e)) return null;

  const code = e.code;
  const details = { code, meta: (e as any).meta };

  switch (code) {
    case "P2002": // Unique constraint failed
      return { status: 409, message: "Unique constraint violation", details };
    case "P2025": // Record not found (for update/delete/findUnique)
    case "P2001": // Record does not exist
      return { status: 404, message: "Not found", details };
    case "P2003": // FK constraint failed
    case "P2014": // Invalid relation
      return { status: 409, message: "Constraint conflict", details };
    case "P2000": // Value too long for column type
    case "P2011": // Null constraint violation
    case "P2012": // Missing required value
    case "P2013": // Missing required argument
    case "P2020": // Value out of range
      return { status: 422, message: "Unprocessable entity", details };
    default:
      // Unknown Prisma known error → treat as 500 but log code/meta
      return { status: 500, message: "Internal Server Error", details };
  }
}
