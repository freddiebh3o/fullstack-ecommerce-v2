// tests/_utils/csrf.ts
/**
 * Double-submit CSRF helper for tests.
 * Matches src/lib/security/csrf.ts: cookie "csrf_token" + header "x-csrf-token".
 */

const COOKIE_NAME = process.env.TEST_CSRF_COOKIE_NAME ?? "csrf_token";
const HEADER_NAME = process.env.TEST_CSRF_HEADER_NAME ?? "x-csrf-token";

export function makeCsrfToken(): string {
  return Math.random().toString(36).slice(2) + Math.random().toString(36).slice(2);
}

export function csrfPair(token = makeCsrfToken()) {
  const cookies = { [COOKIE_NAME]: token };
  const headers: Record<string, string> = { [HEADER_NAME]: token };
  return { token, cookies, headers, cookieName: COOKIE_NAME, headerName: HEADER_NAME };
}
