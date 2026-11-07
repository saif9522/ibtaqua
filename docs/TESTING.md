# Testing

## Automated API tests

```bash
cd backend
npm test
```

Runs `tests/api.test.js` with Node's built-in test runner against a fresh `data/test.sqlite` (migrations + base seed + demo data). Current result: **31 tests, all passing**.

| Area | What is checked |
|---|---|
| Auth | OTP sign-up needs a name and never accepts a wrong code; register with OTP sets a password; mobile + password login; reset password by OTP signs out old sessions; refresh tokens rotate and a reused token revokes the whole family; generic wrong-password message; field-level validation errors |
| RBAC | customers, partners and drivers get 403 on admin APIs; anonymous gets 401; non-super admins cannot change settings; customers cannot use the delivery panel |
| Pricing | guests see customer prices only and no other tier names leak; each partner sees its own tier price; an agreed distributor price overrides the base; partner-only products have no customer price |
| Checkout & orders | unserviceable pincode refused; totals computed on the server while client prices are ignored; free-delivery threshold; COD auto-confirms; FIFO batch allocation; coupon applied server-side and limited per user; jar deposit for new jars; cancel returns stock; users cannot read others' orders; retailer minimum quantity enforced; credit limit enforced |
| Payments | forged Razorpay signature rejected; valid one captures, confirms the order and is idempotent on replay; webhook signature required and duplicate events ignored; refund updates the order |
| Delivery | driver never receives the OTP; pickup → start → wrong OTP rejected → COD cash required → delivered; invoice issued; jars issued; buyer can download the invoice PDF |
| Partners | pending retailer can only reach `/auth/me` and documents until approved; statement balance equals debits − credits |
| Inventory, subscriptions, reports | production batch adds stock; over-adjustment rejected; subscription generation is idempotent; dashboard and all 10 reports work as JSON, Excel and PDF; audit log records admin actions |

The web app is also built in CI-style with `cd frontend && npm run build`, and the mobile bundle with `cd mobile && npx expo export --platform android`.

## Manual test plan (by role)

Start with `npm run db:reset` in `backend/`, run both servers, use `docs/DEMO_ACCOUNTS.md`.

**Customer (phone width, 390 px):** Register a new number with OTP and a password → log out → log in with mobile + password → check pincode 822101 on home → slider swipes → add a 20L jar (deposit shows at checkout) and a 1L case → apply `WELCOME10` → pay online (mock) → order page shows Paid, Confirmed → set up an alternate-day subscription → raise a support ticket → Forgot password flow.

**Admin:** Dashboard alerts → approve the pending retailer (Retailers → Awaiting approval) with a credit limit → Payments → verify the pending bank transfer → Orders → move an order to Ready for dispatch → assign Ravi Kumar → check the Delivery board → record a production batch → quarantine and release it → edit a product price and confirm the store updates → add a zone price → create a coupon → Reports → export GST register to Excel and PDF → Settings → change delivery slots → Activity log shows each action.

**Delivery (Ravi, phone width):** Today's run → Navigate and Call open Maps/dialer → Picked up → Start delivery → enter a wrong OTP (rejected) → the customer's OTP from their order page → cash + empty jars → Delivered → Report shows the cash.

**Wholesaler:** Dashboard credit and offers → Quick order with quantities below minimum (blocked) → valid quantities → pay by credit → Statement shows the debit → admin records a credit payment → statement balance drops.

**Distributor:** Quick order shows the agreed 1L case price → distribution areas on the dashboard.

**Security spot checks:** open `/admin` as a customer (redirected); call `/api/admin/dashboard` with a customer token (403); try to fetch another user's order id (403); upload a renamed `.exe` as a document (rejected); 6th OTP request within an hour (429).
