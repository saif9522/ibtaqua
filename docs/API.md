# REST API

Base URL: `/api`. JSON in and out. **All money values are integer paise** (₹1 = 100).

**Auth:** send `Authorization: Bearer <accessToken>`. Access tokens last 15 minutes; renew with `POST /auth/refresh` (refresh tokens rotate; reusing an old one revokes all sessions).

**Errors:** `{ "error": { "code", "message", "fields"?: [{ path, message }], "details"? } }` with status 400 (bad request), 401, 403, 404, 409 (conflict), 413 (file too large), 422 (validation / cart invalid), 429 (rate limited), 503 (integration not configured).

**Lists** accept `page` and `limit` (max 100) and return `{ data, page, limit, total }`.

Legend: 🌐 public · 👤 any buyer · 🏪 retailer/wholesaler/distributor · 🚚 delivery staff · 🔐 admin (permission in brackets)

## Auth `/api/auth`

| Method & path | Who | Body / notes |
|---|---|---|
| `POST /otp/request` | 🌐 | `{ phone, purpose: login\|register\|reset }` → `{ sent, isNewUser, devOtp? }`. 5 per hour per number. |
| `POST /otp/verify` | 🌐 | `{ phone, code, name?, email?, password? }` → tokens + user. Creates a customer on first use (name required; password optional but set by the web/app register flow). |
| `POST /password/reset` | 🌐 | `{ phone, code, password }` after `otp/request` with `purpose: reset`. Signs out other devices. |
| `POST /login` | 🌐 | `{ identifier: phone or email, password }` |
| `POST /register/:type` | 🌐 | type = `retailer\|wholesaler\|distributor`. `{ businessName, contactPerson, phone, email?, password, gstin?, pan?, address, city, state, pincode }`. Account starts **pending**. |
| `POST /refresh` | 🌐 | `{ refreshToken }` |
| `POST /logout` · `POST /logout-all` | 🌐 · 👤 | |
| `GET /me` · `PATCH /me` | any signed-in (incl. pending) | profile, role, tier, permissions, business |
| `POST /me/password` | any | `{ currentPassword?, newPassword }` |
| `POST /me/documents` · `GET /me/documents` | any | multipart `file` (PDF/JPG/PNG ≤ 5 MB) + `docType` |

## Store (public) `/api`

| Method & path | Notes |
|---|---|
| `GET /settings` | public business settings (brand, contacts, slots, jar deposit…) |
| `GET /categories` | with product counts |
| `GET /products` | `category, search, featured, type, sort=size\|price\|name\|newest`. Send a token to get your tier's price; guests get customer prices. Each item has `price: { tier, unitPrice, listPrice, minOrderQty, source, quantityBreaks }` or `null` if not sold to you. |
| `GET /products/:slug` | detail + images, reviews, related |
| `GET /cms?type=` · `GET /cms/page/:slug` · `GET /testimonials` | website content |
| `GET /delivery/check/:pincode` · `GET /delivery/zones` | serviceability |
| `POST /enquiries` | `{ type: contact\|bulk\|partnership, name, phone, … }` |
| `GET /track/:orderNumber?phone=` | public tracking; needs the phone on the order |

## Buyer account `/api/account` 👤

| Method & path | Notes |
|---|---|
| `GET/POST /addresses`, `PUT/DELETE /addresses/:id` | address is mapped to a delivery zone by pincode |
| `POST /checkout/quote` | `{ items:[{productId,quantity}], addressId?, couponCode?, paymentMethod? }` → line prices, summary (subtotal, discount, GST, delivery, jar deposit, grand total), eligible payment methods, slots |
| `POST /orders` | `{ items, addressId, paymentMethod: razorpay\|upi\|cod\|bank_transfer\|credit, couponCode?, deliveryDate?, deliverySlot?, notes?, source }` → `{ id, orderNumber, nextStep }`. Any price fields sent are ignored. |
| `GET /orders` · `GET /orders/:id` · `GET /orders/:id/status` | history, detail with timeline/payments/delivery OTP, light poll |
| `POST /orders/:id/cancel` · `POST /orders/:id/return` · `GET /orders/:id/reorder` | |
| `GET /orders/:id/invoice.pdf` | after dispatch |
| `POST /payments/razorpay/order` | `{ orderId }` → `{ keyId, providerOrderId, amount, mock }` |
| `POST /payments/razorpay/verify` | Razorpay handler response; idempotent |
| `POST /payments/razorpay/failed` | record a failed attempt |
| `POST /payments/razorpay/dev-sign` | development mock only (disabled with live keys / production) |
| `POST /payments/offline` | `{ orderId, referenceNo, amount, method: bank_transfer\|upi }` → admin verifies |
| `GET /payments` · `GET /bank-details` | |
| `GET/POST /subscriptions`, `POST /subscriptions/:id/pause\|resume\|cancel`, `GET /subscriptions/:id/history` | |
| `POST /reviews` | only for delivered products; moderated |
| `GET/POST /tickets`, `GET /tickets/:id`, `POST /tickets/:id/messages` | support |
| `GET /notifications` · `POST /notifications/read` · `POST /device-tokens` | in-app + FCM token registration |
| `GET /jars` | jar balance and history |
| `GET /business/summary` 🏪 | credit, outstanding, overdue, monthly purchases, offers, agreed prices, zones |
| `POST /business/credit-request` 🏪 | `{ requestedLimit, reason? }` |
| `GET /business/statement?from&to` 🏪 | debits, credits, running balance |

## Delivery `/api/delivery` 🚚 (`delivery.perform`)

| Method & path | Notes |
|---|---|
| `GET /run?status=active\|history&date=` | stops in route order with address, items, amount due, pending jars, Google Maps links and a whole-route link. Delivery OTP is never included. |
| `GET /report?date=` | delivered, failed, cash, empty jars |
| `POST /assignments/:id/pickup` → `/start` → `/complete` | complete: `{ otp, cashCollected, emptyJarsCollected, notes? }`; COD requires the full amount |
| `POST /assignments/:id/fail` | `{ reason }` → order back to dispatched |
| `POST /availability` | `{ available }` |

## Admin `/api/admin` 🔐

**Dashboard & reports** — `GET /dashboard` [dashboard.view] · `GET /reports/:name?from&to&group&tier&format=json|xlsx|pdf` [reports.view], names: `sales, buyers, products, gst, payments, outstanding, delivery, inventory, jars, profit`.

**Users & partners** [users.*, partners.approve, admins.manage] — `GET /users?role&status&search`, `GET/PATCH /users/:id` (business details, credit limit/days, distributor zones and agreement, suspend), `POST /users` (create buyer or delivery staff), `POST /users/:id/reset-password`, `POST /users/:id/approval` `{ decision, reason?, creditLimit?, creditDays? }`, `GET /documents/:id/file`, `PATCH /documents/:id`, `GET /credit-requests`, `POST /credit-requests/:id`, `GET/POST /admins`.

**Catalog & pricing** [products.*, pricing.write] — categories CRUD; products CRUD (`prices: [{ tier, price, minOrderQty, discountPercent }]` is the full base price list; tiers left out stop selling); `POST /products/:id/images` (multipart `images`), set primary, delete; `POST/PUT/DELETE /prices` for zone and agreed prices; `PUT /products/:id/quantity-discounts`.

**Inventory** [inventory.*] — `GET /inventory`, `PATCH /inventory/:productId`, `GET/POST /batches`, `PATCH /batches/:id` (quarantine/release), `POST /inventory/adjust` `{ productId, batchId, quantity, type: adjustment|damage, reason }`, `GET /stock-movements`, packaging `GET/POST /materials`, `POST /materials/:id/adjust`.

**Orders & delivery** [orders.*, delivery.manage] — `GET /orders` (filters: status, payment_status, payment_method, buyer_tier, zoneId, from, to, deliveryDate, unassigned, search), `GET /orders/:id` (allowed transitions, batches), `POST /orders/:id/status`, `POST /orders/bulk-status`, `POST /orders` (on behalf of a buyer), `POST /orders/:id/assign`, `POST /delivery/assign`, `GET /orders/:id/invoice.pdf`, `POST /orders/:id/invoice`, `GET /delivery/board`, `POST /delivery/assignments/:id/sequence`, `POST /delivery-staff/:id/reset-password`, zones `GET/POST/PUT /zones` (pincode clashes rejected).

**Returns** [support.manage] — `GET /returns`, `POST /returns/:id` `{ decision, restock, refundAmount, note }` (refunds captured payments).

**Payments** [payments.*] — `GET /payments`, `GET /payments/:id` (transactions), `POST /payments/:id/verify` `{ approve, note }`, `POST /payments/:id/refund` `{ amount, reason }` (via Razorpay when live), `POST /payments/cash`, `POST /payments/credit-settlement` `{ userId, amount, method, referenceNo }`, `GET /payments-reconciliation`, `GET /invoices`.

**Jars & subscriptions** — `GET /jars`, `GET /jars/:userId/history`, `POST /jars/:userId` `{ type: returned|deposit_collected|deposit_refunded|adjustment|damaged|lost, jars, amount, note }` [jars.write]; `GET /subscriptions`, `POST /subscriptions/:id/:action`, `POST /subscriptions-run` [subscriptions.manage].

**Marketing & content** — coupons CRUD [coupons.write]; CMS CRUD + `POST /uploads/cms` [cms.write]; `POST /notifications/broadcast`, `POST /notifications/payment-reminders`, `GET /notification-outbox` [notifications.send]; tickets, reviews, enquiries [support.manage].

**System** — `GET /settings` [dashboard.view], `PUT /settings { values }` [settings.write], `GET /audit-logs` [audit.read], `POST /backup` [settings.write].

## Webhook

`POST /api/webhooks/razorpay` — raw JSON body, header `X-Razorpay-Signature` (HMAC-SHA256 with `RAZORPAY_WEBHOOK_SECRET`). Handles `payment.captured`, `payment.failed`, `refund.processed`. Duplicate events return `{ duplicate: true }`. Point the Razorpay dashboard webhook to `https://<your-domain>/api/webhooks/razorpay`.

All 163 routes are defined in `backend/src/routes/`.
