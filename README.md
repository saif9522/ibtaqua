# IBT AQUA – E‑commerce, B2B & Distribution Platform

Online ordering and operations for **IBT AQUA** (IBT ENTERPRISES, Palamu, Jharkhand): retail customers, retailers, wholesalers and distributors buy at their own prices; staff run production batches, stock, deliveries, jar returns, payments, GST invoices and reports from one admin panel.

| Folder | What it is | Stack |
|---|---|---|
| `backend/` | REST API + SQLite database | Node.js, Express 5, Knex, better-sqlite3, JWT, Zod, Multer |
| `frontend/` | Store, customer account, partner dashboard, delivery panel, admin panel | React 19, Vite, Tailwind 4, Redux Toolkit, React Router, React Hook Form, Recharts |
| `mobile/` | Android / iOS app (customer, partner and delivery roles) | React Native via Expo, React Navigation, Redux Toolkit |
| `docs/` | Architecture, API, deployment, testing, demo accounts | |

## Quick start (development)

Requirements: Node.js 20+ (22 recommended).

```bash
# 1. API
cd backend
cp .env.example .env
npm install
npm run seed          # creates data/ibt_aqua.sqlite with base data + DEMO data
npm run dev           # http://localhost:4000

# 2. Web (new terminal)
cd frontend
npm install
npm run dev           # http://localhost:5173  (proxies /api to :4000)

# 3. Mobile (optional, new terminal)
cd mobile
cp .env.example .env  # set EXPO_PUBLIC_API_URL to your computer's LAN IP
npm install
npx expo start        # scan the QR code with Expo Go, or press "a" for an Android emulator
```

Log in with the demo accounts in [`docs/DEMO_ACCOUNTS.md`](docs/DEMO_ACCOUNTS.md). In development the OTP code is shown on screen; nothing is texted.

## What's in it

- **Three buyer types, one catalog.** Each product has independent customer / retailer / wholesaler / distributor prices, minimum quantities, product discounts, quantity breaks, zone prices and per-buyer agreed prices. Buyers only ever receive their own price; the server recomputes every total.
- **Order lifecycle** with 11 statuses, a state machine, timeline, live tracking (polling), delivery OTP, cancellations, returns and re-ordering.
- **Payments:** Razorpay (signature + server fetch + signed webhooks, replay-proof), COD, bank transfer/UPI with admin verification, B2B monthly credit with limits and oldest-first settlement, refunds and a reconciliation view.
- **Manufacturing inventory:** production batches with manufacturing/expiry dates, FIFO-by-expiry allocation, reservations to prevent overselling, quarantine, damage, adjustments, packaging materials, auto-expiry and low-stock alerts.
- **20L jar ledger:** deposits, jars issued/returned/pending per buyer, refunds, shortage alerts.
- **Delivery:** zones by pincode, assignment, driver run with Google Maps route, OTP proof of delivery, cash and empty-jar collection, daily reports.
- **Subscriptions:** daily, alternate-day, weekly, monthly or chosen weekdays; pause/resume/cancel; orders generated automatically and idempotently.
- **GST invoices** numbered per financial year (CGST/SGST or IGST), PDF download.
- **Reports** (sales, buyers, products, GST register, payments, outstanding, delivery, inventory, jars, profit estimate) in JSON, Excel and PDF.
- **Notifications:** in-app plus SMS / WhatsApp / email / push through a retrying outbox; providers switch on with keys in `.env`.
- **Security:** bcrypt, short-lived JWTs with rotating refresh tokens and reuse detection, RBAC with 23 permissions, Zod validation, Helmet, CORS allow-list, rate limits, upload type + magic-byte checks, private KYC files, audit log, online backups.

## Tests

```bash
cd backend && npm test     # 31 end-to-end API tests on a throwaway database
```

See [`docs/TESTING.md`](docs/TESTING.md) for what they cover and the manual test plan per role.

## Before going live

Read [`docs/DEPLOYMENT.md`](docs/DEPLOYMENT.md). In short: set real secrets and `OTP_DEV_ECHO=false`, run `npm run seed:prod` (never the demo seed), fill in **Admin → Settings** (business details, GSTIN, FSSAI/BIS, bank, delivery slots), create real products, prices and zones, and add Razorpay + SMS keys.

> Prices, GST rates, pincodes and business details in the demo data are placeholders. Confirm GST rates for HSN 2201 with your accountant.
# ibtaqua
