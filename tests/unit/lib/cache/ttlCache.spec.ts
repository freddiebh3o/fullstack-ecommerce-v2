import { describe, it, expect, vi } from "vitest";
import { TtlCache } from "@/lib/cache/ttlCache";

describe("TtlCache", () => {
  it("stores and expires values", async () => {
    const c = new TtlCache<string, number>({ ttlMs: 10 });
    c.set("a", 1);
    expect(c.get("a")).toBe(1);
    await new Promise(r => setTimeout(r, 15));
    expect(c.get("a")).toBeUndefined();
  });

  it("evicts when over maxSize", () => {
    const c = new TtlCache<string, number>({ ttlMs: 1000, maxSize: 2 });
    c.set("a", 1); c.set("b", 2); c.set("c", 3);
    // naive eviction deleted first key
    expect(c.get("a")).toBeUndefined();
    expect(c.get("b")).toBe(2);
    expect(c.get("c")).toBe(3);
  });
});
