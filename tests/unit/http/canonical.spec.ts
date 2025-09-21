import { describe, it, expect, beforeEach, afterEach, vi } from "vitest";
import { canonicalFrom } from "@/lib/http/canonical";

function H(h: Record<string, string>) {
  const headers = new Headers();
  Object.entries(h).forEach(([k, v]) => headers.set(k, v));
  return headers;
}

describe("canonicalFrom", () => {
  beforeEach(() => {
    vi.unstubAllEnvs(); // clean slate before each test
  });

  afterEach(() => {
    vi.unstubAllEnvs(); // and after, to avoid test pollution
  });

  it("uses APP_BASE_URL when set (wins over headers)", () => {
    vi.stubEnv("APP_BASE_URL", "https://app.example.com");
    const c = canonicalFrom(H({ host: "ignored.local" }));
    expect(c.origin).toBe("https://app.example.com");
    expect(c.protocol).toBe("https:");
    expect(c.host).toBe("app.example.com");
  });

  it("uses X-Forwarded-* when present", () => {
    // no APP_BASE_URL stub -> should use forwarded headers
    const c = canonicalFrom(
      H({
        "x-forwarded-proto": "https",
        "x-forwarded-host": "shop.example.com",
        host: "internal:3000",
      })
    );
    expect(c.origin).toBe("https://shop.example.com");
  });

  it("falls back to Host, https in prod", () => {
    vi.stubEnv("NODE_ENV", "production");
    const c = canonicalFrom(H({ host: "my.example.com" }));
    expect(c.origin).toBe("https://my.example.com");
  });

  it("falls back to Host, http in dev", () => {
    vi.stubEnv("NODE_ENV", "development");
    const c = canonicalFrom(H({ host: "localhost:3000" }));
    expect(c.origin).toBe("http://localhost:3000");
  });
});
