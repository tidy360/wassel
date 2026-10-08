# Cashiri — Frontend (Phase 11, first drop)

React + Vite + TypeScript + Tailwind. Mobile-first, Arabic RTL by default
with an English toggle (spec section 26).

## What's built

- **Design**: "Nile teal" (`#0E5F5A`) + warm gold accent (`#D99E1F`) on a
  warm paper background — Tajawal for Arabic, Inter for numbers/Latin.
  Numbers always render left-to-right (`.num` class) even inside RTL layout,
  so money never mirrors.
- **Auth**: login page, JWT stored in `localStorage`, auto-redirect to
  `/login` on a 401.
- **Layout**: sidebar on desktop, bottom nav on mobile with big tap targets
  (spec section 38), separate nav sets for Super Admin vs store users.
- **POS screen** (`/pos`) — the core screen: search-as-you-type product
  lookup, camera barcode scanning (`@zxing/browser`), cart with qty
  +/−, invoice-level discount, payment-method selection, camera capture
  for bank-transfer receipts (spec section 5), and **offline-first
  checkout**: if `navigator.onLine` is false (or the request fails
  mid-flight), the sale is queued in `localStorage` and flushed to
  `/api/store/sync` automatically on reconnect (spec section 27).
- **Merchant dashboard**, **Products** (+ create form), **Purchases**
  (+ create form), **Suppliers**, **Sales**, **Customers**, **Reports**
  (profit summary), **Store settings** (profile/tax/payment methods, tabbed),
  **User management**, **Cash session / daily closing** — functional screens
  hitting the Phase 3-8 API.
- **Super Admin dashboard**, **Tenants** list, **Create tenant + first store**
  form (shows the generated store-admin password once, as the backend
  intends).

## Local setup

```bash
npm install
cp .env.example .env   # point VITE_API_URL at your backend
npm run dev             # http://localhost:5173
```

## Deploying free

Any static host works — Vercel, Netlify, Cloudflare Pages, or even Render's
free static-site tier. Build with `npm run build`, the output is `dist/`.
Set `VITE_API_URL` to your deployed backend's URL as a build-time env var.

- **Merchant dashboard**, **Products** (+ create/edit form), **Purchases**
  (+ create form), **Suppliers** (+ statement view), **Sales** (+ print/PDF
  button), **Customers** (+ statement view), **Reports** (profit summary,
  date-range filter, Excel download for sales/purchases/inventory-valuation),
  **Store settings** (profile/tax/payment methods, tabbed), **User
  management**, **Cash session / daily closing**, **Audit log** — functional
  screens hitting the Phase 3-8 API.
- **Notifications bell** in the header (polls every 60s, mark-as-read).
- **Super Admin dashboard**, **Tenants** list (+ expandable stores → users →
  **"Login as Store" impersonation trigger**), **Create tenant + first
  store** form.
- **Impersonation banner** — a persistent warning bar with a "switch back"
  button appears anywhere in the store UI while a Super Admin is
  impersonating (spec section 32).
- **Toast notifications** (`ToastContext`) — success/error/info, used for
  sale returns and cancellations so far, easy to reuse anywhere else.
- **Sale detail page** (`/sales/:id`) — cancel with a reason, or return
  specific items in any quantity (partial or full).
- **Admin plan management** (`/admin/plans`) — create/toggle subscription
  plans, limits shown per plan.
- **Full reports UI** — profit summary, date-range filter, Excel download
  for sales/purchases/inventory-valuation, plus tabbed tables for expenses,
  top products, low stock, and cancelled invoices.

- **Purchase detail page** (`/purchases/:id`) — return specific items to
  the supplier in any quantity, mirrors the sale-return pattern.
- **Admin subscription assign/extend** — inline in the Tenants page's
  expanded row: pick a plan + end date, confirm.

## Project status

Every module from the original spec (sections 1-40) now has a working
backend endpoint and a frontend screen, end to end: multi-tenant
architecture with real RLS + backend isolation, Super Admin platform
management, full POS with offline support, purchases/inventory,
accounting basics (expenses, cash sessions, daily closing), reports (with
Excel export), audit logging, notifications, file uploads, and Super Admin
impersonation.

## Known limitations (by design, not oversights)

- **Invoice PDF Arabic text** doesn't shape/join correctly (`pdfkit` has no
  bidi/shaping engine) — see the comment in the backend's
  `invoicePdf.controller.ts` for the fix path.
- **Notifications poll every 60s** rather than pushing in real time — fine
  for a single-store POS pace of work, a websocket/SSE upgrade is a later
  nice-to-have, not a blocker.
- **No automated tests yet** — everything here has been written for
  correctness (transactions, tenant scoping, stock math double-checked by
  hand) but hasn't run against a live environment yet, since this sandbox
  has no network access to install packages or reach your Supabase project.
  Test it locally per the setup steps above before relying on it.
