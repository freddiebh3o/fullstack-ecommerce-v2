// tests/unit/lib/hosts/normalize.spec.ts
import { describe, it, expect } from "vitest";
import { normalizeHost } from "@/lib/hosts/normalizeHost";

describe("normalizeHost", () => {
  it("strips port and www, lowercases", () => {
    expect(normalizeHost("WWW.Example.com:3000")).toBe("example.com");
  });
  it("handles x-forwarded-host with commas", () => {
    expect(normalizeHost("a.example.com, b.example.com")).toBe("a.example.com");
  });
  it("accepts localhost and IPs", () => {
    expect(normalizeHost("localhost:8080")).toBe("localhost");
    expect(normalizeHost("127.0.0.1:3000")).toBe("127.0.0.1");
  });
  it("returns null for bad input", () => {
    expect(normalizeHost("not a host")).toBeNull();
    expect(normalizeHost("")).toBeNull();
    expect(normalizeHost(undefined)).toBeNull();
  });
});
