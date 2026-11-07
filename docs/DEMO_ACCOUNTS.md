# Demo accounts (development only)

Created by `npm run seed` in `backend/`. **Never load demo data in production** (the seed script refuses when `NODE_ENV=production`).

| Role | Log in with | Password | Lands on |
|---|---|---|---|
| Super admin | `9000000001` or `admin@ibtaqua.test` | `Admin@123` | `/admin` |
| Admin (operations) | `9000000002` or `ops@ibtaqua.test` | `Admin@123` | `/admin` |
| Delivery staff (city) | `9000000011` | `Delivery@123` | `/delivery` |
| Delivery staff (rural) | `9000000012` | `Delivery@123` | `/delivery` |
| Retailer (approved, credit ₹20,000) | `9000000201` | `Retail@123` | `/business` |
| Retailer (pending approval) | `9000000202` | `Retail@123` | `/business/documents` |
| Wholesaler (credit ₹1.5 lakh) | `9000000301` | `Whole@123` | `/business` |
| Distributor (agreed price on 1L cases) | `9000000401` | `Dist@123` | `/business` |
| Customers | `9000000101`, `9000000102`, `9000000103` | none yet — use **Forgot password?** to set one by OTP | `/account` |

In development the OTP is shown on screen (`OTP_DEV_ECHO=true`), so any mobile number works for **New account / Register**.

## What the demo data contains

- 2 delivery zones: Medininagar City (822101, 822102) and Palamu Rural (8 pincodes). Placeholder pincodes; verify before use.
- 9 products across the 7 categories, with sample prices for every buyer type (e.g. 1 L bottle ₹20 / ₹15 / ₹12 / ₹11), quantity breaks, a rural-zone price and a distributor price agreement.
- 2 production batches per product, packaging materials and empty-jar stock.
- About 70 orders over the last 60 days placed through the real order service (so stock, invoices, jars and payments are consistent), a pending bank transfer to verify, partial credit settlements, 3 subscriptions, reviews, a support ticket, a bulk enquiry and a credit request.
- Coupons: `WELCOME10`, `JAR20` (customers), `RETAIL5` (retailers), `BULK500` (wholesalers and distributors).

Payments run in **mock mode** without Razorpay keys: the checkout asks you to confirm a simulated payment, and the server still verifies a signature.

Reset everything: `npm run db:reset`.
