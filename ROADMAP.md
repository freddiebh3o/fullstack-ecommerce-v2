# Roadmap — Admin-First Multi-Tenant Platform (UK B2B Wholesale)  
_Target: single Next.js app in a monorepo, custom domains, strong tenant isolation; storefront comes **after** the admin and is powered by a CMS inside the admin that composes pages from reusable row components._

---

## Assumptions
- One Next.js 15+ app (App Router) with API routes; Prisma + Postgres.
- App-level tenant isolation via Prisma `$extends` is present; RLS to be added later for defense-in-depth.
- Multi-tenant via domain mapping table (`Domain`), custom domains supported.
- Admin side is delivered first. Storefront is rendered by the **same app**, driven by an **in-admin CMS** (page/row/blocks).
- UK B2B standards apply: VAT, multi-warehouse stock, credit terms, quote→SO→pick/pack→ship→invoice.

> Tip: Treat RLS as infra boilerplate applied when new tenant-scoped tables are introduced. Keep a policy template handy.

---

## Repo Status Snapshot (today)
- ✅ Next.js app, API routes, NextAuth (JWT), Prisma client with tenant scoping.
- ✅ Security posture: CSRF (double-submit), security headers, origin checks, rate limiting, idempotency key store.
- ✅ Tables: User, Tenant, Membership, Domain, Product (base), Brand, Category, ProductImage, AuditLog, IdempotencyKey.
- ⚠️ Gaps to address early: host→tenant domain resolution; no admin UI yet; no warehouse/stock, customers, pricing, sales flow, VAT, RLS.

---

# Phases (Admin first, then Storefront CMS)

## Phase 0 — Foundations & Repo Health
- [x] Ensure **single Prisma client** is exported (no stray `new PrismaClient()` calls).
- [x] README quick-start: install, migrate, seed, run, test.

**Exit criteria**
- `npm db:migrate && npm db:generate && npm test && npm dev` all succeed.
- New clone can boot in <10 min following README.

---

## Phase 1 — Tenant Resolution & Custom Domains (Backbone)
- [x] Implement **host→tenant** resolution (Node runtime helper preferred) using `Domain` table.
- [x] Set `tenant_id` in secure cookie / request context; unknown hosts → safe 404 or onboarding.
- [x] Conceptualised manual process for setting domains for merchants
- [x] Canonicals & links derive from **tenant primary domain**.

**Exit criteria**
- Visiting wildcard subdomains or registered custom domains yields the same resolved `tenantId`.
- Per-host requests never leak across tenants (tested).

---

## Phase 2 — Admin Shell & RBAC
- [ ] Use Mantine component library for admin shell
- [ ] Admin layout: sidebar, topbar, current tenant indicator, role-aware nav.
- [ ] Route guards: OWNER/ADMIN/WAREHOUSE/SALES (examples; adjustable).
- [ ] Tenant switcher (if user has multiple tenants).

**Exit criteria**
- Unauthorized roles see “forbidden” views; nav only shows allowed sections.
- OWNER can switch tenant context without page hacks.

---

## Phase 2.5 — Tenant Admin Branding/Theming
- [ ] Ability to allow the tenant OWNER to customise the branding/theming of the admin panel
- [ ] Need to figure out all the different theme variables we allow the user to customise.

**Exit criteria**
- Unauthorized roles see “forbidden” views; nav only shows allowed sections.
- OWNER can switch tenant context without page hacks.

---

## Phase 3 — Admin: Users & Memberships
- [ ] Members list/create/update/remove; invite flow (email or magic link).
- [ ] Role management UI and API; audit on changes.
- [ ] Password reset / credential management (or SSO placeholder).

**Exit criteria**
- OWNER can invite ADMIN/STAFF; changes reflected immediately; audited.

---

## Phase 4 — Catalog Management
- [ ] Products CRUD: name, SKU, slug, status, media, attributes.
- [ ] Brands & Categories CRUD; composite uniques with `(tenantId, sku|slug)`.
- [ ] Basic search/filter/sort; pagination; soft delete/archive.
- [ ] Assets via signed URL to S3/R2; image processing pipeline minimal.

**Exit criteria**
- Admin users can maintain a clean catalogue with images and categories.
- Server-side validation & idempotency for creates/updates in place.

---

## Phase 5 — Warehouses & Stock Control (UK baseline)
- [ ] Tables: `Warehouse`, `StockLevel`, `StockAdjustment` (audited), optional `Transfer`.
- [ ] Admin UI: manage warehouses; view per-warehouse stock; make adjustments (reasons).
- [ ] Guard rails: configurable negative stock policy; idempotent adjustments.

**Exit criteria**
- Accurate per-warehouse on-hand and allocated quantities; adjustments audited.
- Negative stock prevented or explicitly allowed with warnings (config).

---

## Phase 6 — B2B Customers (Accounts & Contacts)
- [ ] Tables: `CustomerAccount`, `CustomerContact` (+ address info, VAT no.).
- [ ] Admin UI: create accounts, assign contacts, set status (active/hold).
- [ ] Optional: reuse global `User` for contacts or separate auth surface (decision documented).

**Exit criteria**
- Admin can manage customer companies & their staff; ready for pricing/ordering.

---

## Phase 7 — Pricing & Credit Terms
- [ ] Tables: `PriceList`, `ContractPrice`, `CreditTerms` (net days, limits, available credit).
- [ ] Resolver: MSRP → PriceList → ContractPrice (per account) with fallbacks.
- [ ] Display: VAT-inclusive/exclusive toggles; currency = GBP (v1).

**Exit criteria**
- For any account, system resolves a single correct unit price for a product.
- Admin can set price lists and per-account overrides; credit terms visible.

---

## Phase 8 — Sales Ops: Quote → Sales Order
- [ ] Tables: `Quote`, `QuoteLine`, `SalesOrder`, `SalesOrderLine` (immutable captured prices/taxes).
- [ ] Convert Quote→Order; idempotent creation; audit transitions.
- [ ] Allocation step: allocate stock on order confirmation (respect warehouse selection).

**Exit criteria**
- SALES/ADMIN can convert quotes to orders; prices/taxes captured; allocations created.

---

## Phase 9 — Pick/Pack/Ship & Documents
- [ ] Tables: `Pick`, `PickLine`, `Shipment` (carrier, tracking), `DeliveryNote` (doc record).
- [ ] Flows: picking lists, pack confirmation, ship; decrement stock; generate delivery note (PDF/HTML).
- [ ] Partial shipments/back-orders supported.

**Exit criteria**
- Warehouse can pick/pack/ship; stock decrements correctly; delivery notes generated.

---

## Phase 10 — VAT-Compliant Invoicing
- [ ] VAT codes (20/5/0) at product or line level; per-line VAT calc.
- [ ] `Invoice`, `InvoiceLine`, `CreditNote`; totals and VAT breakdown; references to orders/shipments.
- [ ] Invoice rendering (PDF/HTML) with UK HMRC-compliant fields; exports (CSV/JSON).

**Exit criteria**
- Invoices are correct, auditable, and exportable for accounting (Xero/Sage later).

---

## Phase 11 — RLS (Row-Level Security) Rollout
- [ ] Session variable (e.g., `app.tenant_id`) set per request/transaction.
- [ ] For each tenant-scoped table: ENABLE RLS + standard `USING/WITH CHECK` policies.
- [ ] App DB role without `BYPASSRLS`; tests prove cross-tenant access is impossible.

**Exit criteria**
- With app guard removed in tests, RLS still blocks cross-tenant reads/writes.
- Queries error if session tenant is not set; happy paths green.

---

## Phase 12 — Admin UX Polish & Performance
- [ ] List virtualization for big tables; optimistic updates where safe.
- [ ] Smart filters (by status, warehouse, stock thresholds).
- [ ] Indexes on hot paths (tenantId, sku, slug, createdAt); N+1 audits.

**Exit criteria**
- P95 admin interactions under target (e.g., <300ms reads on key screens).

---

## Phase 13 — **Storefront CMS (Inside Admin)**
> Storefront comes after admin. The CMS allows composing pages from reusable **row components**; storefront rendering reads this content.

- [ ] Data model:
  - `Page` (slug, title, status, publishedAt, seo fields).
  - `Row` (order, type: hero, product-grid, rich-text, banner, CTA, etc.).
  - `Block`/`Props` (JSON schema per row type with validation via Zod).
  - `MediaAsset` references for images/files.
- [ ] Admin UI:
  - Visual page builder: add/reorder rows, edit props; draft preview; publish flow.
  - Theme tokens editor (logo, colors, typography) separate from admin theme.
- [ ] Content governance:
  - Versioning/drafts; audit on publishes; per-tenant **primary domain** target.

**Exit criteria**
- Admin can create a homepage and a product landing page using rows; preview draft; publish to primary domain.
- Validation prevents broken layouts; rows have schema-backed props.

---

## Phase 14 — Storefront Rendering (Same App)
- [ ] Public routes resolve pages by slug from CMS; 404 fallback; canonical URLs.
- [ ] Row renderer library (SSR) for each row type; streaming where beneficial.
- [ ] Product rows resolve pricing/availability for current **CustomerAccount** (if logged in) with tenant isolation.

**Exit criteria**
- Visiting the tenant domain shows published CMS pages; row library renders consistently; SEO basics (title/meta/sitemap) per domain.

---

## Phase 15 — Search & Performance
- [ ] DB indexes + query tuning for catalogue; cursor-based pagination.
- [ ] Optional search engine (Typesense/Algolia) with tenant scoping.
- [ ] Cache hot fragments (per tenant) where safe; CDN headers for assets/content.

**Exit criteria**
- Storefront list/search P95 within targets (<300ms common queries); isolation preserved.

---

## Phase 16 — Integrations (Accounting & Carriers)
- [ ] Accounting: start with invoice exports; later OAuth API sync (Xero/Sage/QuickBooks).
- [ ] Carriers: label generation for one provider (DPD/Royal Mail) as a pilot.
- [ ] Webhooks: signed, idempotent; retry strategy; per-tenant secrets.

**Exit criteria**
- At least one accounting pathway operational; one carrier label printable from Shipment.

---

## Phase 17 — Observability, CI/CD, Safety Nets
- [ ] CI: typecheck, lint, tests, migrate dry-run; preview deploys per PR with seeded tenant.
- [ ] Logs: structured logs for auth/order/stock; request IDs; domain/tenant tags.
- [ ] Alarms on error spikes; rate-limit metrics; idempotency replay monitoring.

**Exit criteria**
- Every PR gets a preview; migrations verified pre-merge; logs allow tracing an order lifecycle.

---

## Phase 18 — Documentation & Onboarding
- [ ] Tenant onboarding: create tenant → add/verify domain → theme → invite staff.
- [ ] CMS authoring guide (rows/props), pricing rules guide, VAT guide, order flow.
- [ ] Custom domain DNS docs (CNAME vs ALIAS/ANAME) for common providers.

**Exit criteria**
- A new tenant can self-serve from signup to first published storefront page using only docs.

---

## Permanent Guardrails
- Use a **single Prisma client** that enforces tenant scoping; forbid direct client instantiation.
- Contract tests that intentionally attempt cross-tenant access and **must fail**.
- Build URLs from **current host** or **tenant primary domain**; never hard-code platform domain.
- Keep Prisma in **Node runtime** only; no DB at Edge.
- Treat RLS as a **boilerplate policy** per tenant-scoped table; update only when schema changes.

---

### Glossary
Tenant · Membership · CustomerAccount · CustomerContact · Warehouse · StockLevel · StockAdjustment · PriceList · ContractPrice · CreditTerms · Quote · SalesOrder · Pick · Shipment · Invoice · CreditNote · RLS · FIFO · VAT · POD · Idempotency · Canonical URL · Row/Block (CMS).
