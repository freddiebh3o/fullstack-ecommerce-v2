// tests/_utils/next-auth.mock.ts
import { vi } from "vitest";
import { getNextRequestHeaders } from "./next-context";

// Mock just what we need from next-auth for server routes
vi.mock("next-auth", async () => {
  return {
    // App Router API: getServerSession(...): Promise<Session | null>
    getServerSession: async () => {
      const h = getNextRequestHeaders();
      // Convention: if tests set x-test-user-id, we consider the user "logged in"
      const userId = h?.get("x-test-user-id") || null;
      const email = h?.get("x-test-user-email") || "test@example.com";
      if (!userId) return null;

      // Return the minimal session shape your requireSession() likely expects
      return {
        user: { id: userId, email },
        expires: new Date(Date.now() + 60 * 60 * 1000).toISOString(),
      } as any;
    },
  };
});
