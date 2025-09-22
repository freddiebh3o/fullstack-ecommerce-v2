// src/app/admin/_utils/http.ts
'use client';

import { nprogress } from '@mantine/nprogress';

function escapeRegex(str: string) {
  return str.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function readCookie(name: string): string | null {
  const pattern = new RegExp('(?:^|;\\s*)' + escapeRegex(name) + '=([^;]*)');
  const m = document.cookie.match(pattern);
  return m ? decodeURIComponent(m[1]) : null;
}

/** ---------- Progress control (shared counter + minDelay) ---------- */
let inflight = 0;
let firstStartAt = 0;

function startProgress() {
  if (inflight === 0) {
    firstStartAt = Date.now();
    nprogress.start();
  }
  inflight += 1;
}

function completeProgress(minDelayMs = 0) {
  inflight = Math.max(0, inflight - 1);
  if (inflight > 0) return; // keep running until last request finishes

  const elapsed = Date.now() - firstStartAt;
  const wait = Math.max(0, minDelayMs - elapsed);

  if (wait === 0) {
    nprogress.complete();
  } else {
    setTimeout(() => nprogress.complete(), wait);
  }
}

/** Options for http helpers */
export type HttpOptions = {
  /** Show top progress bar (default: true) */
  progress?: boolean;
  /** Minimum total visible time for the bar (ms). Example: 300ms */
  minDelayMs?: number;
  /** Extra fetch init */
  init?: RequestInit;
};

export async function getCsrfToken(): Promise<string> {
  const res = await fetch('/api/security/csrf', {
    method: 'GET',
    cache: 'no-store',
    credentials: 'same-origin',
  });

  let token: string | undefined;
  try {
    const body = await res.json();
    token =
      body?.token ??
      body?.data?.token ??
      (typeof body?.data === 'string' ? body.data : undefined);
  } catch {
    // ignore
  }
  if (!token) {
    token =
      readCookie('csrf') ??
      readCookie('csrf_token') ??
      readCookie('csrfToken') ??
      readCookie('x-csrf-token') ??
      undefined;
  }
  if (!token) throw new Error('CSRF token missing');
  return token;
}

export async function getJson<T = any>(url: string, opts: HttpOptions = {}): Promise<T> {
  const { progress = true, minDelayMs = 0, init } = opts;
  if (progress) startProgress();

  try {
    const res = await fetch(url, {
      cache: 'no-store',
      credentials: 'same-origin',
      ...init,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = body?.error || body?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body as T;
  } finally {
    if (progress) completeProgress(minDelayMs);
  }
}

export async function postJson<T = any>(url: string, data: unknown, opts: HttpOptions = {}): Promise<T> {
  const { progress = true, minDelayMs = 0, init } = opts;
  if (progress) startProgress();

  try {
    const [csrf, idem] = [await getCsrfToken(), crypto.randomUUID()];
    const res = await fetch(url, {
      method: 'POST',
      credentials: 'same-origin',
      headers: {
        'content-type': 'application/json',
        'x-csrf-token': csrf,
        'Idempotency-Key': idem,
        ...(init?.headers || {}),
      },
      body: JSON.stringify(data ?? {}),
      ...init,
    });
    const text = await res.text();
    const body = text ? JSON.parse(text) : {};
    if (!res.ok) {
      const msg = body?.error || body?.message || `HTTP ${res.status}`;
      throw new Error(msg);
    }
    return body as T;
  } finally {
    if (progress) completeProgress(minDelayMs);
  }
}
