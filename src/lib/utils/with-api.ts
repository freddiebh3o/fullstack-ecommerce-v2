// src/lib/utils/with-api.ts
import { NextResponse } from "next/server";
import { loggerForRequest } from "@/lib/log";

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
