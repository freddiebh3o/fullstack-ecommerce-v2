// app/(storefront)/page.tsx
import { notFound } from "next/navigation";
import { getTenantId } from "@/lib/tenant/context";

export default async function StorefrontHome() {
  const tid = getTenantId();
  if (!tid) return notFound();
  // ...render storefront for tid
  return <main>Welcome</main>;
}
