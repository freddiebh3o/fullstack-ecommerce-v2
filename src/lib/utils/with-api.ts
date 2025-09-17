// src/lib/utils/with-api.ts
import { NextResponse } from "next/server";
import { loggerForRequest } from "@/lib/log/log";
import { ipFromRequest, rateLimitFixedWindow } from "../security/rate-limit";

// Overload: handlers without ctx
export function withApi<TRes extends NextResponse = NextResponse>(
  handler: (req: Request) => Promise<TRes> | TRes
): (req: Request) => Promise<TRes>;

// Overload: handlers with ctx (e.g., { params })
export function withApi<TCtx, TRes extends NextResponse = NextResponse>(
  handler: (req: Request, ctx: TCtx) => Promise<TRes> | TRes
): (req: Request, ctx: TCtx) => Promise<TRes>;

// Impl
export function withApi(handler: (req: Request, ctx?: unknown) => Promise<NextResponse> | NextResponse) {
  return async (req: Request, ctx?: unknown) => {
    const started = Date.now();
    const { log, requestId } = loggerForRequest(req);

    if (req.method !== "GET") {
      const ip = ipFromRequest(req);
      const stats = rateLimitFixedWindow({
        key: `mut:ip:${ip}`,
        limit: Number(process.env.RL_MUTATION_PER_IP_PER_MIN || 120),
        windowMs: 60_000,
      });
      if (!stats.ok) {
        log.warn({ event: "rate_limited", scope: "mut:ip", ip, ...stats });
        const res = NextResponse.json({ ok: false, error: "Too Many Requests", requestId }, { status: 429 });
        res.headers.set("x-request-id", requestId);
        res.headers.set("Retry-After", String(stats.retryAfter ?? 60));
        res.headers.set("X-RateLimit-Limit", String(stats.limit));
        res.headers.set("X-RateLimit-Remaining", String(stats.remaining));
        return res;
      }
    }

    try {
      const res: NextResponse = await handler(req, ctx);
      res.headers.set("x-request-id", requestId);

      log.info({
        status: res.status,
        durationMs: Date.now() - started,
      });

      return res;
    } catch (err) {
      log.error(
        {
          durationMs: Date.now() - started,
          err,
        },
        "unhandled_route_error"
      );

      return NextResponse.json({ ok: false, error: "Internal Server Error" }, { status: 500 });
    }
  };
}
