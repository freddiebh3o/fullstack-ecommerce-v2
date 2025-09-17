// src/lib/utils/http.ts
import { NextResponse } from "next/server";
import { getOrCreateRequestId } from "@/lib/log/log";

type Extra = Record<string, unknown> | undefined;

// Overloads (for TS ergonomics)
// ok(data)
// ok(data, status, req?)
// ok(data, init, req?)
export function ok<T>(data: T): NextResponse;
export function ok<T>(data: T, status: number, req?: Request): NextResponse;
export function ok<T>(data: T, init: ResponseInit, req?: Request): NextResponse;
export function ok<T>(
  data: T,
  statusOrInit?: number | ResponseInit,
  req?: Request
) {
  const body: Record<string, unknown> = { ok: true, data };
  let requestId: string | undefined;

  if (req) {
    requestId = getOrCreateRequestId(req.headers);
    body.requestId = requestId;
  }

  let status = 200;
  let init: ResponseInit | undefined;

  if (typeof statusOrInit === "number") {
    status = statusOrInit;
  } else if (statusOrInit && typeof statusOrInit === "object") {
    init = statusOrInit;
  }

  const res = NextResponse.json(body, { status, ...(init ?? {}) });
  if (requestId) res.headers.set("x-request-id", requestId);
  return res;
}

export function fail(
  status: number,
  error: string,
  extra?: Extra,
  req?: Request
) {
  const body: Record<string, unknown> = { ok: false, error, ...(extra ?? {}) };
  let requestId: string | undefined;

  if (req) {
    requestId = getOrCreateRequestId(req.headers);
    body.requestId = requestId;
  }

  const res = NextResponse.json(body, { status });
  if (requestId) res.headers.set("x-request-id", requestId);
  return res;
}
