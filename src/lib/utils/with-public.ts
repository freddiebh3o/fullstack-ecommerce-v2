import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { loggerForRequest } from "@/lib/log/log";
import { withTenant } from "@/lib/tenant/withTenant";
import { mapPrismaError } from "@/lib/utils/prisma-errors";
import { fail } from "@/lib/utils/http";
import { getTenantId } from "@/lib/tenant/context";

/** Public routes: only work with host-resolved tenant; never use cookie fallback. */
export function withPublic<TRes extends NextResponse = NextResponse>(
  handler: (req: Request) => Promise<TRes> | TRes
): (req: Request) => Promise<TRes>;
export function withPublic<TCtx, TRes extends NextResponse = NextResponse>(
  handler: (req: Request, ctx: TCtx) => Promise<TRes> | TRes
): (req: Request, ctx: TCtx) => Promise<TRes>;

export function withPublic(
  handler: (req: Request, ctx?: unknown) => Promise<NextResponse> | NextResponse
) {
  return async (req: Request, ctx?: unknown) => {
    const started = Date.now();
    const { log, requestId } = loggerForRequest(req);

    try {
      const res: NextResponse = await withTenant(
        async () => {
          const tid = getTenantId();
          if (!tid) {
            // Unknown host (or pending-in-prod) -> pretend it doesn't exist.
            return fail(404, "Not found", undefined, req) as NextResponse;
          }
          return Promise.resolve(handler(req, ctx));
        },
        {
          allowCookieFallbackForAdmin: false,
          allowPendingInDev: process.env.NODE_ENV !== "production",
        },
        req
      );

      res.headers.set("x-request-id", requestId);
      log.info({ status: res.status, durationMs: Date.now() - started });
      return res;
    } catch (err) {
      if (err instanceof ZodError) {
        const issues = err.flatten();
        log.info({ event: "zod_validation_error", issues, durationMs: Date.now() - started });
        return fail(422, "Invalid input", { issues }, req) as NextResponse;
      }

      const mapped = mapPrismaError(err);
      if (mapped) {
        log.warn(
          { event: "prisma_error", status: mapped.status, ...mapped.details, durationMs: Date.now() - started },
          mapped.message
        );
        return fail(mapped.status, mapped.message, undefined, req) as NextResponse;
      }

      if (err instanceof SyntaxError) {
        log.info({ event: "malformed_json", durationMs: Date.now() - started });
        return fail(400, "Malformed JSON", undefined, req) as NextResponse;
      }

      log.error({ event: "unhandled_public_route_error", err, durationMs: Date.now() - started }, "unhandled_public_route_error");
      return fail(500, "Internal Server Error", undefined, req) as NextResponse;
    }
  };
}
