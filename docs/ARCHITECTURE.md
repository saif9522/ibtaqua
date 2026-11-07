# Architecture

```
            ┌──────────────────────┐       ┌──────────────────────┐
            │  Web (React + Vite)  │       │ Mobile (React Native)│
            │ store · account ·    │       │ customer · partner · │
            │ business · delivery ·│       │ delivery             │
            │ admin                │       └──────────┬───────────┘
            └──────────┬───────────┘                  │  HTTPS + JWT
                       │  /api                        │
            ┌──────────▼──────────────────────────────▼───────────┐
            │            Express API (backend/src)                │
            │ routes → validators (Zod) → services → Knex → SQLite │
            │ middleware: helmet, CORS, rate limit, auth, RBAC    │
            │ jobs: subscriptions, batch expiry, outbox, backups  │
            └───────┬───────────────┬──────────────┬──────────────┘
                    │               │              │
              SQLite (WAL)   Razorpay API   SMS / WhatsApp / email / FCM
```

## Principles

- **The server owns every number.** Clients send product ids and quantities. Prices, discounts, GST, delivery charges, jar deposits and totals are computed in `services/order.service.js` from the database. The same `quote()` function powers the checkout preview and order placement, so what buyers see is what they pay.
- **Money is integer paise** in the database and API (₹1 = 100) to avoid rounding errors. Formatting happens in the clients.
- **Prices are GST-inclusive** by default (setting `prices_include_gst`), as on Indian MRP labels; taxable value and GST are split per line.
- **Nothing business-specific is hard-coded.** Prices, GST, delivery charges, slots, deposit rules, payment methods, minimum orders, invoice prefix, notification channels and company details live in tables or `system_settings`, editable in the admin panel.
- **Portable database layer.** Migrations use only Knex schema builders. Moving to PostgreSQL means changing `client` and `connection` in `src/config/knexfile.js` (the few SQLite date functions in reports are isolated in `report.service.js`).

## Backend layout

```
backend/src
  config/        env (validated), knexfile, RBAC roles & permissions, notification defaults
  database/      db instance, seed runner, base seed (prod-safe), demo data (dev only)
  migrations/    two migrations: identity & catalog; operations
  middleware/    auth (JWT, roles, permissions), validation & errors, uploads
  validators/    Zod schemas
  services/      pricing, order, inventory, payment, delivery, jar, subscription, invoice,
                 report, notification (+ providers), settings, auth, audit
  routes/        auth, public, account (buyers), delivery, admin/{system,users,catalog,operations}
  jobs/          in-process scheduler
  utils/         errors, helpers (money, dates, ids), backup
```

## Roles and permissions

Roles: `super_admin`, `admin`, `delivery`, `customer`, `retailer`, `wholesaler`, `distributor`. Each buyer role maps to a price tier. Staff permissions (23 keys such as `orders.write`, `pricing.write`, `settings.write`) are stored in `role_permissions` and checked per route; `admin` has everything except managing admins and changing settings. B2B accounts start `pending` and can only upload documents until approved.

## Pricing resolution

For a product and buyer: agreed price for that user → price for the delivery zone → base tier price. Then the product discount %, then the best quantity break. No price row for the tier means the product is not sold to that tier (it shows without a price and cannot be added).

## Order state machine

```
pending → confirmed → processing → packed → ready_for_dispatch → dispatched → out_for_delivery → delivered
   └──────────┴───────────┴────────────┴──────────────┴→ cancelled           ↑ (failed attempt)  │
                                                                                                  └→ return_requested → returned
```

| Transition | Side effects |
|---|---|
| placed | stock **reserved** (conditional update prevents overselling), coupon used, admins notified; COD/credit auto-confirm (configurable) |
| → confirmed | stock **deducted from batches FIFO by expiry**, buyer notified |
| → dispatched | GST invoice issued |
| → out_for_delivery | buyer gets the delivery OTP |
| → delivered | OTP verified, cash recorded, jars issued, deposit recorded, empties collected |
| → cancelled | reservation released or stock restocked to the same batches; coupon returned |
| → returned | optional restock; refunds through payments |

## Inventory invariant

`sum(active batch quantity_remaining) = inventory.available + inventory.reserved` for every product. Every change writes a `stock_movements` row.

## Payments

Razorpay order created server-side → checkout → `/verify` checks the HMAC signature and (with live keys) fetches the payment to confirm amount and status → marked captured. Webhooks are HMAC-verified on the raw body and de-duplicated by event id. `provider_payment_id` is unique, so a payment can't be applied twice. Bank transfers and UPI references wait for admin verification. Credit settlements are applied to the oldest unpaid credit orders first.

## Database tables

All tables named in the brief exist, plus supporting ones:

`roles, permissions, role_permissions, users, otp_codes, refresh_tokens, user_addresses, customers, retailers, wholesalers, distributors, distributor_zones, business_documents, credit_requests, categories, products, product_images, product_prices, quantity_discounts, system_settings, cms_content, audit_logs, delivery_zones, inventory, inventory_batches, packaging_materials, stock_movements, coupons, coupon_usage, subscriptions, subscription_orders, orders, order_items, order_item_batches, order_status_history, return_requests, payments, payment_transactions, invoices, delivery_staff, delivery_assignments, jar_balances, jar_transactions, notifications, notification_outbox, device_tokens, reviews, support_tickets, ticket_messages, enquiries`

Foreign keys are enforced (`PRAGMA foreign_keys = ON`), money columns are integers, and indexes cover the common filters (status + date, user, product).

## Brand

The client's IBT AQUA logo and product photos are in `frontend/public/brand/` and `mobile/assets/brand/`. Palette: white and aqua (`#0596B4`) with deep-water blue (`#0A4A63`) for headings, light-blue grounds (`#EEF7FA`), marigold only for deposits and items needing attention. Type: Bricolage Grotesque (display) and Instrument Sans (UI).
