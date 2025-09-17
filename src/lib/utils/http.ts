import { NextResponse } from "next/server";

type OkBody<T> = { ok: true; data: T };
type ErrBody<E extends string = string> = { ok: false; error: E } & Record<string, unknown>;

export function ok<T>(data: T, init?: number | ResponseInit) {
  const resInit = typeof init === "number" ? { status: init } : init;
  return NextResponse.json<OkBody<T>>({ ok: true, data }, resInit);
}

export function fail<E extends string>(status: number, error: E, extra?: Record<string, unknown>) {
  return NextResponse.json<ErrBody<E>>({ ok: false, error, ...(extra ?? {}) }, { status });
}
