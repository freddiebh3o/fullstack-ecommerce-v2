# fullstack-ecommerce-v2

Backend-first, tenant‑isolated e‑commerce API built with Next.js App Router, TypeScript, Prisma, and NextAuth.

---

## ✨ Highlights
- **Multi‑tenant architecture** with app‑layer tenant isolation (Prisma `$extends` + tenant‑scoped client).
- **Strict security posture:** CSRF double‑submit, Origin/Referer checks, hardened security headers, and consistent error envelopes.
- **Robust data safety:** Idempotency for POST/PATCH, **optimistic concurrency (OCC)** with `version`, and structured audit logging.
- **B2B‑ready**: Membership caps per tenant (owners/managers/viewers), GBP integer pricing with `priceInPence`.
- **Observability:** Pino logs with `x-request-id`, Prisma→HTTP error mapping.


---

## 🧱 Tech Stack
- **Next.js** `15.5.3` (App Router, server routes)
- **TypeScript** `^5` (strict mode)
- **PostgreSQL + Prisma** (`^6.16.2` / `^6.16.2`)
- **Auth:** NextAuth `^4.24.11` (Credentials + bcrypt `^3.0.2`)
- **Validation:** Zod `^4.1.8`
- **Logging:** Pino `^9.9.5`

---

## 📂 Project Structure (truncated)
```
fullstack-ecommerce-v2/
  ├─ .env
  ├─ README.md
  ├─ docker-compose.yml
  ├─ eslint.config.mjs
  ├─ next-env.d.ts
  ├─ next.config.ts
  ├─ package-lock.json
  ├─ package.json
  ├─ postcss.config.mjs
  ├─ print-tree.mjs
  ├─ prisma/
    ├─ migrations/
      ├─ 20250916151030_init/
      ├─ 20250916210134_product_default_gbp/
      ├─ 20250916210703_product_price_pence/
      ├─ 20250916211940_user_add_name/
      ├─ 20250917162626_add_domain/
      ├─ 20250917184201_idempotency_keys/
      ├─ 20250917204820_occ_version_columns/
      ├─ 20250917204911_occ_version_columns_2/
      ├─ migration_lock.toml
    ├─ schema.prisma
    ├─ seed.ts
  ├─ prisma.config.ts
  ├─ public/
    ├─ file.svg
    ├─ globe.svg
    ├─ next.svg
    ├─ vercel.svg
    ├─ window.svg
  ├─ scripts/
    ├─ cleanup-idempotency.mjs
    ├─ smoke-db.ts
    ├─ smoke-tenant.ts
  ├─ src/
    ├─ app/
      ├─ api/
      ├─ favicon.ico
      ├─ globals.css
      ├─ layout.tsx
      ├─ page.tsx
    ├─ lib/
      ├─ auth/
      ├─ core/
      ├─ db/
      ├─ log/
      ├─ security/
      ├─ utils/
      ├─ validation/
    ├─ middleware.ts
    ├─ types/
      ├─ next-auth.d.ts
  ├─ tests/
    ├─ members-guards.spec.ts
    ├─ setup.ts
    ├─ tenant-guard.spec.ts
  ├─ tsconfig.json
  ├─ tsconfig.tsbuildinfo
  ├─ vitest.config.mts
```

Key folders/files:
- `prisma/schema.prisma` — data model, with `tenantId` and `version` columns detected.
- `app/` or `src/app/` — App Router API routes (see list below).
- `middleware.ts` — security headers / CSRF plumbing (see **Security**).
- `src/lib/` — DB client, HTTP helpers (e.g. `withApi`), validation, etc.

---

## 🗃️ Data Model (from `prisma/schema.prisma`)
- **Models detected:** IdempotencyKey, Domain, User, Tenant, Membership, Product, AuditLog
- `tenantId` present across models.

> Keep prices in **GBP** via `priceInPence` (integer).

---

## 🔐 Security
- **CSRF double‑submit:** `csrf` cookie + `x-csrf-token` header.
- **Origin/Referer** checks on state‑changing routes.
- **Security headers** set globally in `middleware.ts` (CSP/XFO/XCTO/Referrer/Permissions/HSTS).
- **Session & Tenant selection:** NextAuth JWT carries `userId`. A secure `tenant_id` cookie selects active tenant after membership check.
- **Rate limiting:** per‑IP and per‑user controls in HTTP helpers (if enabled in code).
- **Idempotency:** `Idempotency-Key` header on POST/PATCH to avoid duplicate effects.

---

## 🧪 Testing
- **Type checks:** `npm run typecheck`
- **Build:** `npm run build`
- **Dev:** `npm run dev`
- **Prisma:** `npx prisma migrate dev`, `npx prisma studio`
- **(Optional) Unit tests:** `npm test` if configured

> Add minimal API tests for idempotency/OCC/tenant guards.

---

## ⚙️ Environment Setup
Create `.env` from `.env.example` (if present) and set:
- `DATABASE_URL` — Postgres connection string
- `NEXTAUTH_SECRET` — for NextAuth
- `NEXTAUTH_URL` — base URL for auth callbacks
- Any S3/LocalStack or email envs (if used by the repo)

Run migrations:
```bash
npm install
npx prisma generate
npx prisma migrate dev
npm run dev
```

---

## 🧭 API Routes (App Router)

Below are the main API endpoints, their purpose, and example request/response shapes.

---

### Authentication
- `POST /api/auth/signin` — Authenticate with credentials (NextAuth).
```http
POST /api/auth/signin
Content-Type: application/json

{ "email": "user@example.com", "password": "secret" }
```
Response:
```json
{ "ok": true, "data": { "userId": "usr_123", "sessionToken": "..." }, "requestId": "..." }
```

---

### Tenant Management
- `POST /api/tenant/select` — Set the active tenant cookie after membership verification.
```http
POST /api/tenant/select
Content-Type: application/json

{ "tenantId": "ten_123" }
```
Response:
```json
{ "ok": true, "data": { "tenantId": "ten_123" }, "requestId": "..." }
```

- `GET /api/tenant/current` — Return the current tenant for the session.
Response:
```json
{ "ok": true, "data": { "id": "ten_123", "name": "Acme Ltd" }, "requestId": "..." }
```

- `GET /api/me/tenants` — List all tenants the current user belongs to.
Response:
```json
{ "ok": true, "data": [
  { "id": "ten_123", "name": "Acme Ltd", "caps": { "isOwner": true } },
  { "id": "ten_456", "name": "OtherCo", "caps": { "canManageProducts": true } }
], "requestId": "..." }
```

---

### Products (Tenant-scoped)
- `GET /api/admin/products` — List or search products.
```http
GET /api/admin/products?search=widget&page=1
```
Response:
```json
{ "ok": true, "data": { "items": [ { "id": "prod_123", "name": "Widget", "priceInPence": 1999, "version": 1 } ], "total": 1 }, "requestId": "..." }
```

- `POST /api/admin/products` — Create a product (idempotent).
Headers: `Idempotency-Key: unique-key-123`
```http
POST /api/admin/products
Content-Type: application/json

{ "sku": "WIDG-001", "name": "Widget", "priceInPence": 1999 }
```
Response:
```json
{ "ok": true, "data": { "id": "prod_123", "version": 1 }, "requestId": "..." }
```

- `PATCH /api/admin/products/[id]` — Update with Optimistic Concurrency Control (OCC).
```http
PATCH /api/admin/products/prod_123
Content-Type: application/json

{ "expectedVersion": 1, "priceInPence": 2099 }
```
Successful Response:
```json
{ "ok": true, "data": { "id": "prod_123", "version": 2 }, "requestId": "..." }
```
Conflict Response (409):
```json
{ "ok": false, "error": "version_conflict", "expectedVersion": 1, "currentVersion": 2, "requestId": "..." }
```

- `DELETE /api/admin/products/[id]` — Delete a product.
```http
DELETE /api/admin/products/prod_123
```
Response:
```json
{ "ok": true, "data": null, "requestId": "..." }
```

---

### Members (Tenant-scoped)
- `GET /api/admin/members` — List tenant members.
Response:
```json
{ "ok": true, "data": [ { "id": "mem_123", "userId": "usr_123", "email": "owner@example.com", "caps": { "isOwner": true }, "version": 1 } ], "requestId": "..." }
```

- `POST /api/admin/members` — Add an existing user to the tenant.
Headers: `Idempotency-Key: unique-key-abc`
```http
POST /api/admin/members
Content-Type: application/json

{ "email": "new.user@example.com", "caps": { "canViewProducts": true } }
```
Response:
```json
{ "ok": true, "data": { "id": "mem_456", "userId": "usr_456", "version": 1 }, "requestId": "..." }
```

- `PATCH /api/admin/members/[id]` — Update member permissions with OCC.
```http
PATCH /api/admin/members/mem_456
Content-Type: application/json

{ "expectedVersion": 1, "caps": { "canManageProducts": true } }
```
Response:
```json
{ "ok": true, "data": { "id": "mem_456", "version": 2 }, "requestId": "..." }
```

- `DELETE /api/admin/members/[id]` — Remove a member (with safeguard: cannot remove last owner).
```http
DELETE /api/admin/members/mem_456
```
Response:
```json
{ "ok": true, "data": null, "requestId": "..." }
```

---

## Common API Conventions
- **All responses** follow the envelope: `{ ok, data?, error?, requestId }`.
- **Idempotency-Key** required on POST/PATCH to prevent duplicate processing.
- **OCC** enforced on PATCH (must include `expectedVersion`).
- **Rate limiting** may return `429` with `Retry-After` and `X-RateLimit-*` headers.
- **Errors**:
  - 401: Unauthorized (no/invalid session)
  - 403: Forbidden (not in tenant or insufficient caps)
  - 404: Not found
  - 409: Version conflict
  - 422: Validation issues (with `issues` array)

---

---

## 🧰 Developer Workflow
- Use **Postman/Insomnia** to exercise server routes (no frontend dependency).
- Always select a tenant with `/api/tenant/select` before admin operations.
- For mutations:
  - Include **`Idempotency-Key`** (unique per intent).
  - Include **`expectedVersion`** when updating versioned resources.

---

## 🪵 Logging & Audit
- Pino logs with `x-request-id` correlation.
- Structured **AuditLog** on create/update/delete with diffs (incl. `version`).
- Avoid logging secrets; ensure Pino redaction covers tokens and passwords.

---

## 📐 Coding Standards
- TypeScript **strict**; Zod schemas in `src/lib/core/schemas.ts`.
- Consistent HTTP envelope helpers `ok()`/`fail()` and `mapPrismaError()`.
- ESLint config present: no.

---
