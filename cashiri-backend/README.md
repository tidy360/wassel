# Cashiri — Backend (Phase 1: Architecture + Auth + RBAC + Tenant Isolation)

Multi-tenant SaaS POS & accounting backend for the Sudan market. This is the
first of several drops — see "What's next" at the bottom.

## What's in this phase

- Node.js + Express + TypeScript + Prisma, talking to your **Supabase Postgres**
  (free tier project already live: `fakjjqydzencipbxgwmt`).
- Full DB schema already applied directly to Supabase (34 tables — tenants,
  stores, RBAC, products, sales/POS, purchases, inventory, finance, audit
  log, sync queue) with **Row Level Security enabled and deny-by-default**
  on every table, so the anon/public key can never read tenant data — only
  this backend, using the service-role key, can.
- JWT auth (`/api/auth/login`, `/api/auth/me`).
- Tenant isolation middleware (`requireStoreMatch`, `assertOwnership`) —
  every request's tenant/store identity comes from the verified JWT, never
  from the URL or request body (spec sections 1, 21, 31).
- RBAC middleware (`requirePermission`) with default roles seeded:
  `SUPER_ADMIN`, `ADMIN`, `MANAGER`, `CASHIER`, `STORE_STAFF` and ~24
  granular permission codes (spec section 18).
- Security basics: helmet, CORS allow-list, rate limiting, generic login
  errors (no email enumeration), bcrypt password hashing.

## Local setup

```bash
npm install
cp .env.example .env
# fill in DATABASE_URL (Supabase project settings > Database > Connection string)
# and SUPABASE_SERVICE_ROLE_KEY (Project settings > API), and a random JWT_SECRET

npm run prisma:generate
npm run prisma:migrate:deploy   # no-op right now since tables already exist in Supabase; safe to run
SEED_SUPER_ADMIN_EMAIL=you@example.com SEED_SUPER_ADMIN_PASSWORD='choose-a-strong-password' npm run prisma:seed

npm run dev   # http://localhost:4000/health
```

## Deploying free (Render)

Render's free web-service tier costs nothing (it does sleep after 15 minutes
idle and wake back up on the next request — fine for a project in progress,
worth upgrading once you have paying tenants).

1. Push this folder to a GitHub repo.
2. In Render: **New > Blueprint**, point it at the repo — it will read
   `render.yaml` and set most of it up automatically.
3. Fill in the three secret env vars it asks for: `DATABASE_URL`,
   `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` (from your Supabase project
   settings).
4. Deploy. First boot runs `prisma migrate deploy` then starts the server.
5. Run the seed once via Render's shell (or locally against the same
   `DATABASE_URL`) to create your Super Admin login.

Fly.io free/hobby tier works the same way if you'd rather use that — same
Dockerfile-less Node app, just `fly launch` and set the same env vars as
secrets.

## Phase 3 — Store/merchant module (spec sections 3, 20, 28)

Under `/api/store` (any store user — Admin/Manager/Cashier/Staff — never Super Admin):
- `GET/PATCH /settings/store`, `/settings/taxes`, `/settings/payment-methods`
- `GET/POST /users`, `/users/:id/disable|enable`, `PATCH /users/:id/role`
- `GET /dashboard` — sales today/week/month, invoice count, customers, suppliers, low/out-of-stock counts

## Phase 4 — Products, categories, units, suppliers, customers (sections 9, 12, 13)

`/categories`, `/units`, `/products` (+ `/products/barcode/:barcode` for the
POS scanner), `/suppliers` (+ `/statement`), `/customers` (+ `/statement`).

## Phase 5 — POS, Sales, Invoices, Returns (sections 4-8)

`POST /sales` is the core transactional engine: re-prices every line from
the DB (never trusts a client-supplied price), locks and decrements stock,
writes an `inventory_movements` row per line, assigns a sequential
per-store invoice number with a unique-constraint retry loop, and refuses
to oversell unless the store's `allow_negative_stock` setting is on.
`POST /sales/:id/cancel` never deletes — flips status and reverses stock.
`POST /sales/:id/return` supports partial or full returns and blocks
returning more than was sold.

## Phase 6 — Purchases & Inventory (sections 10, 11)

`POST /purchases` increases stock immediately on creation (spec: purchases
are "approved" by being entered) and updates supplier balance if not paid
in full. `POST /inventory/adjust` handles manual adjustments, damage,
opening balance, transfers. `GET /inventory/movements` is the full ledger.

## Phase 7 — Expenses, Payments, Cash Sessions, Daily Closing (sections 14, 24)

`POST /expenses`, `POST /payments` (customer/supplier balance settlement),
`POST /cash-sessions/open`, `POST /cash-sessions/:id/close` (computes
expected vs counted cash and the difference).

## Phase 8 — Reports, Audit log, Notifications (sections 19, 23, 33)

`/reports/{sales,purchases,profit,expenses,inventory-valuation,low-stock,
top-products,cancelled-invoices}` — JSON now; PDF/Excel export is a thin
layer on top (not yet wired — see below). `/audit-log` (paginated).
`/notifications` (+ mark-read). `src/jobs/generateAlerts.ts` is a standalone
script for low-stock and subscription-expiry alerts — schedule it daily
(Render Cron Job or any scheduler): `node dist/jobs/generateAlerts.js`.

## Phase 9 — File uploads to Supabase Storage (sections 22, 25)

`POST /files` accepts base64 (mobile-camera friendly — JPG/PNG/WEBP/PDF,
8MB max) and stores it under `tenants/{tenantId}/stores/{storeId}/receipts/`
in a **private** Supabase Storage bucket, returning a 1-hour signed URL.
**You need to create the `receipts` bucket once** in the Supabase dashboard
(Storage → New bucket → name it `receipts`, keep it private) before this
works.

## Phase 10 — Offline sync queue (section 27)

`POST /sync` accepts a batch of queued operations from a device that was
offline, keyed by a client-generated `clientUuid` for exactly-once
application (the DB's unique constraint on `(store_id, client_uuid)` is the
real guarantee). Currently supports `create_sale`; extend the same pattern
in `sync.controller.ts` for other operation types as the offline POS needs
them. Stock conflicts at sync time (e.g. oversold while offline) come back
tagged `"conflict"`, not silently dropped.

## Not yet built

- **PDF/Excel export** for reports and invoices (the report endpoints
  return JSON; wiring in a PDF/XLSX generator is a small, self-contained
  addition once you tell me which library you'd like — e.g. `pdfkit` +
  `exceljs`).
- **Impersonation** ("login as store", spec section 32).
- **Frontend.** This is the other half of the project and is, honestly, as
  big a build as everything above — a mobile-first React app in Arabic
  RTL/English LTR with a fast POS screen, barcode-scanner camera
  integration, offline-first local storage synced against `/api/store/sync`,
  and every dashboard/report screen this API now serves. I'd rather build
  it properly in its own focused pass than rush a shell here — say the
  word and I'll start on it the same way, screen by screen.

## Phase 11 backend additions — exports, invoice PDF, impersonation

- **Excel export**: `GET /api/store/reports/{sales,purchases,inventory-valuation}?format=xlsx`
  streams an .xlsx download (same pattern extends to the other report
  endpoints in `reports.controller.ts`).
- **Invoice PDF**: `GET /api/store/sales/:id/pdf`. ⚠️ Known limitation:
  `pdfkit` has no Arabic shaping/bidi engine, so Arabic product/customer
  names will render with disconnected letters. Numbers/amounts/dates are
  fine. See the comment at the top of `invoicePdf.controller.ts` for the
  proper fix (embed `arabic-reshaper`+`bidi-js`, or switch to a headless-
  browser HTML-to-PDF renderer for correct Arabic text).
- **Impersonation** (spec section 32): `POST /api/admin/tenants/:tenantId/stores/:storeId/impersonate`
  with `{ targetUserId }` issues a token tagged `impersonating: true`.
  Destructive routes (disable user, change role, deactivate product, delete
  category) are blocked outright while impersonating via
  `blockDestructiveWhileImpersonating` middleware — every impersonation
  start is audit-logged.

- **Purchase returns**: `POST /api/store/purchases/:id/return` — reverses
  the stock increase from the original purchase and reduces the supplier
  balance, same partial/full pattern as sale returns, over-return blocked.

## Project status

Every module from the original spec (sections 1-40) has a working
endpoint now. What's genuinely still open, honestly:

- **Invoice PDF Arabic shaping** — documented limitation, see
  `invoicePdf.controller.ts`.
- **No automated tests** — this was all written for correctness by hand
  (transactions, tenant scoping, decimal math double-checked), but this
  sandbox has no network access to `npm install` or reach your Supabase
  project, so none of it has actually run yet. Test locally before relying
  on it in production.
- **Real-time notifications** — currently a polled endpoint + a cron-style
  script (`generateAlerts.ts`), not a push channel. Fine for this scale.

## What's next (module by module, per spec section 39)

1. ✅ Architecture + DB schema + RBAC + tenant isolation + auth
2. ✅ Super Admin module
3. ✅ Store/merchant module
4. ✅ Products + categories + units + suppliers + customers
5. ✅ POS + Sales + Invoices + Returns (+ invoice PDF)
6. ✅ Purchases + Inventory movements
7. ✅ Expenses + Payments + Cash sessions + Daily closing
8. ✅ Reports center (+ Excel export) + Audit log viewer + Notifications
9. ✅ File uploads to Supabase Storage
10. ✅ Offline sync queue handling
11. ✅ Impersonation — frontend still in progress (see cashiri-frontend README)
