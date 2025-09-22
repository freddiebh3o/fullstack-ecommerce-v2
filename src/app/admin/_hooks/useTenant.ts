// src/app/admin/_hooks/useTenant.ts
'use client';

import { useEffect, useState } from 'react';

type Tenant = { id: string; name: string; slug?: string };

export function useTenant() {
  const [tenant, setTenant] = useState<Tenant | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function load() {
      setLoading(true);
      try {
        const res = await fetch('/api/tenant/current', { cache: 'no-store' });
        if (!res.ok) {
          if (res.status === 404) {
            if (!cancelled) {
              setTenant(null);
              setError('no-tenant');
            }
          } else {
            const body = await res.json().catch(() => null);
            if (!cancelled) setError(body?.error || `HTTP ${res.status}`);
          }
          return;
        }

        const body = await res.json();
        const raw = body?.data ?? null;

        // ✅ normalize { tenantId | id, name, slug } -> { id, name, slug }
        const normalized: Tenant | null = raw
          ? {
              id: (raw as any).id ?? (raw as any).tenantId,
              name: (raw as any).name,
              slug: (raw as any).slug,
            }
          : null;

        if (!cancelled) {
          setTenant(normalized);
          setError(null);
        }
      } catch (e: any) {
        if (!cancelled) setError(e?.message || 'network');
      } finally {
        if (!cancelled) setLoading(false);
      }
    }

    load();
    return () => {
      cancelled = true;
    };
  }, []);

  return { tenant, loading, error };
}
