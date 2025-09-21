import { describe, it, expect } from "vitest";
import { absoluteUrl, joinPath, withQuery } from "@/lib/http/url";
import { canonicalFrom } from "@/lib/http/canonical";

function H(h: Record<string,string>) {
  const headers = new Headers();
  Object.entries(h).forEach(([k,v]) => headers.set(k, v));
  return headers;
}

describe("url helpers", () => {
  it("joinPath trims/joins slashes", () => {
    expect(joinPath("/admin/", "/products/", "123")).toBe("/admin/products/123");
    expect(joinPath("admin", "products")).toBe("/admin/products");
  });

  it("withQuery appends non-empty params", () => {
    const path = withQuery("/api/items", { q: "shoes", limit: 25, skip: undefined, flag: false });
    expect(path).toBe("/api/items?q=shoes&limit=25&flag=false");
  });

  it("absoluteUrl builds from canonical + path + query", () => {
    const headers = H({ "x-forwarded-proto": "https", "x-forwarded-host": "app.example.com" });
    const url = absoluteUrl(headers, "/admin/products", { cursor: "abc" });
    expect(url).toBe("https://app.example.com/admin/products?cursor=abc");
  });
});
