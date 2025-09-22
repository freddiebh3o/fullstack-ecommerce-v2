
"use client";

import { useEffect, useState } from "react";

export type RawTenant =
  | { id: string; name: string }
  | {
      tenantId: string;
      name: string;
      slug?: string;
      caps?: Record<string, boolean>;
    };

export type LiteTenant = { id: string; name: string };

export function useTenants(enabled = true) {
  const [tenants, setTenants] = useState<LiteTenant[] | null>(null);
  const [loading, setLoading] = useState(enabled);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!enabled) return;
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch("/api/me/tenants", { cache: "no-store" });
    
        if (!res.ok) {
          const body = await res.json().catch(() => null);
          if (!cancelled) setError(body?.error || `HTTP ${res.status}`);
          return;
        }

        const body = await res.json();
        const raw: RawTenant[] = body?.data ?? [];

        // normalize to { id, name }
        const mapped: LiteTenant[] = raw
          .map((t) => ({
            id: (t as any).id ?? (t as any).tenantId, // <- handle both shapes
            name: (t as any).name,
          }))
          .filter((t) => t.id && t.name);

        if (!cancelled) {
          setTenants(mapped);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || "network");
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, [enabled]);

  return { tenants, loading, error };
}
