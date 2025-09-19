// tests/_utils/auth.ts
import { uniq, mkTenantWithOwner } from "./factories";

/**
 * Creates a fresh tenant + owner membership, and returns headers/cookies that
 * mark the request as authenticated and tenant-selected for your app.
 *
 * - Adds `x-test-user-id` header so our next-auth mock returns a session.
 * - Adds `tenant_id` cookie so your tenant selection reads it.
 */
export async function withAuthAndTenant() {
  const { tenant, owner } = await mkTenantWithOwner();

  // Build common headers used in tests
  const headers: Record<string, string> = {
    "x-test-user-id": owner.id,            // consumed by our next-auth mock
    "x-test-user-email": owner.email ?? `${uniq()}@example.com`,
  };

  // Return cookie jar entries to pass into buildReq({ cookies })
  const cookies = {
    tenant_id: tenant.id, // adjust if your app uses a different cookie name
  };

  return { headers, cookies, tenantId: tenant.id, userId: owner.id };
}
