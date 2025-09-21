// src/lib/utils/with-api.ts
import { NextResponse } from "next/server";
import { ZodError } from "zod";
import { loggerForRequest } from "@/lib/log/log";
import { ipFromRequest, rateLimitFixedWindow } from "../security/rate-limit";
import { mapPrismaError } from "@/lib/utils/prisma-errors";
import { fail } from "@/lib/utils/http";
import { withTenant } from "@/lib/tenant/withTenant";

// Overload: handlers without ctx
export function withApi<TRes extends NextResponse = NextResponse>(
  handler: (req: Request) => Promise<TRes> | TRes
): (req: Request) => Promise<TRes>;

// Overload: handlers with ctx (e.g., { params })
export function withApi<TCtx, TRes extends NextResponse = NextResponse>(
  handler: (req: Request, ctx: TCtx) => Promise<TRes> | TRes
): (req: Request, ctx: TCtx) => Promise<TRes>;

export function withApi(
  handler: (req: Request, ctx?: unknown) => Promise<NextResponse> | NextResponse
) {
  return async (req: Request, ctx?: unknown) => {
    const started = Date.now();
    const { log, requestId } = loggerForRequest(req);

    // Per-IP mutation rate limit
    if (req.method !== "GET") {
      const ip = ipFromRequest(req);
      const stats = rateLimitFixedWindow({
        key: `mut:ip:${ip}`,
        limit: Number(process.env.RL_MUTATION_PER_IP_PER_MIN || 120),
        windowMs: 60_000,
      });
      if (!stats.ok) {
        log.warn({
          event: "rate_limited",
          scope: "mut:ip",
          ip,
          ...stats,
          durationMs: Date.now() - started,
        });
        return fail(
          429,
          "Too Many Requests",
          undefined,
          req,
          {
            headers: {
              "Retry-After": String(stats.retryAfter ?? 60),
              "X-RateLimit-Limit": String(stats.limit),
              "X-RateLimit-Remaining": String(stats.remaining),
            },
          }
        ) as NextResponse;
      }
    }

    try {
      // 👇 ensure tenant context is derived from THIS request
      const res: NextResponse = await withTenant(
        () => Promise.resolve(handler(req, ctx)),
        {
          allowCookieFallbackForAdmin: true,
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

      log.error({ event: "unhandled_route_error", err, durationMs: Date.now() - started }, "unhandled_route_error");
      return fail(500, "Internal Server Error", undefined, req) as NextResponse;
    }
  };
}