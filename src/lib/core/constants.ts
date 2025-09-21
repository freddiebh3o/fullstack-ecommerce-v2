// src/lib/core/constants.ts
export const TENANT_COOKIE = "tenant_id";

export function tenantCookieAttributes() {
  return {
    httpOnly: true,
    sameSite: "lax" as const,
    secure: process.env.NODE_ENV === "production",
    path: "/",
    maxAge: 60 * 60 * 24 * 7, // 7 days
  };
}
