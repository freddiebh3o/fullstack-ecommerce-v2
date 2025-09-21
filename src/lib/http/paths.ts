// src/lib/http/paths.ts

// Admin app pages
export const admin = {
  dashboard: () => "/admin",
  products: {
    list: () => "/admin/products",
    item: (id: string) => `/admin/products/${id}`,
  },
  members: {
    list: () => "/admin/members",
    item: (id: string) => `/admin/members/${id}`,
  },
};

// API routes
export const api = {
  csrf: () => "/api/security/csrf",
  products: () => "/api/admin/products",
  product: (id: string) => `/api/admin/products/${id}`,
  members: () => "/api/admin/members",
  member: (id: string) => `/api/admin/members/${id}`,
  tenant: {
    select: () => "/api/tenant/select",
    current: () => "/api/tenant/current",
  },
  me: {
    tenants: () => "/api/me/tenants",
  },
};
