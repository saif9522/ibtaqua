# Deployment guide

A single small VPS (1–2 vCPU, 2 GB RAM, Ubuntu 22.04/24.04) runs the whole system: SQLite handles a regional water business comfortably. The API serves the built web app from the same origin in production.

## 1. Server setup

```bash
sudo apt update && sudo apt install -y nginx git build-essential
curl -fsSL https://deb.nodesource.com/setup_22.x | sudo -E bash - && sudo apt install -y nodejs
sudo npm i -g pm2
sudo adduser --disabled-password ibt && sudo su - ibt
git clone <your-repo> ibt-aqua && cd ibt-aqua
```

## 2. Configure the API

```bash
cd backend
cp .env.example .env
nano .env
```

Set at least:

- `NODE_ENV=production`
- `JWT_ACCESS_SECRET`, `JWT_REFRESH_SECRET` — two different random strings (`node -e "console.log(require('crypto').randomBytes(48).toString('hex'))"`)
- `OTP_DEV_ECHO=false` (the server refuses to start in production otherwise)
- `CORS_ORIGINS=https://www.ibtaqua.in` (plus any other web origins)
- `SUPER_ADMIN_PHONE`, `SUPER_ADMIN_EMAIL`, `SUPER_ADMIN_PASSWORD` for the first login
- `RAZORPAY_KEY_ID`, `RAZORPAY_KEY_SECRET`, `RAZORPAY_WEBHOOK_SECRET`
- `SMS_PROVIDER=msg91` and `SMS_API_KEY` (needed for OTP logins), optionally WhatsApp Cloud API, SMTP and FCM keys

```bash
npm ci --omit=dev
npm run seed:prod      # migrations + roles, permissions, settings, categories, first super admin. No demo data.
```

## 3. Build the web app

```bash
cd ../frontend
npm ci
npm run build          # outputs frontend/dist, served by the API in production
```

If the web app is hosted separately (e.g. a CDN), build with `VITE_API_URL=https://api.ibtaqua.in/api npm run build` and add that origin to `CORS_ORIGINS`.

## 4. Run with PM2

```bash
cd ../backend
pm2 start src/server.js --name ibt-aqua --env production
pm2 save && pm2 startup     # follow the printed command to start on boot
```

Run **one** instance (SQLite + in-process jobs). If you ever scale out, move to PostgreSQL first and set `ENABLE_JOBS=false` on all but one instance.

## 5. Nginx + HTTPS

```nginx
server {
  server_name www.ibtaqua.in ibtaqua.in;
  client_max_body_size 12m;
  location / {
    proxy_pass http://127.0.0.1:4000;
    proxy_set_header Host $host;
    proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;
    proxy_set_header X-Forwarded-Proto $scheme;
  }
}
```

```bash
sudo apt install -y certbot python3-certbot-nginx && sudo certbot --nginx -d ibtaqua.in -d www.ibtaqua.in
```

## 6. First login and go-live checklist

1. Log in at `/login` with the super admin phone + password.
2. **Settings → business:** legal name, address, GSTIN, FSSAI, BIS licence, phone, WhatsApp, email, plant location (`{"lat":…,"lng":…}` for route planning).
3. **Settings → payments:** bank details for B2B transfers, COD limit, enabled methods. **Settings → jars:** deposit amount and who pays it.
4. **Delivery zones:** real pincodes, charges, free-delivery thresholds.
5. **Products:** create real SKUs with photos, GST % (confirm HSN 2201 rates with your CA), and prices for each buyer type.
6. **Manufacturing & batches:** record opening stock as batches.
7. **Delivery staff** and **Admin users.**
8. **Website CMS:** banners (upload photos), About, Privacy, Terms, Refund policy, FAQs.
9. Razorpay dashboard → webhook `https://www.ibtaqua.in/api/webhooks/razorpay`, events `payment.captured`, `payment.failed`, `refund.processed`.
10. Place a ₹1 test order end to end, refund it, and check the GST register.

## 7. Backups

- Automatic: a daily online SQLite backup to `backend/backups/` (last 14 kept). Manual: **Settings → Back up database** or `npm run backup`.
- Copy backups off the server, e.g. a nightly cron: `rclone copy ~/ibt-aqua/backend/backups remote:ibt-aqua-backups`.
- Restore: stop the app, replace `data/ibt_aqua.sqlite` with a backup file (and delete the `-wal`/`-shm` files), start the app.

## 8. Updating

```bash
git pull
cd backend && npm ci --omit=dev && npx knex --knexfile src/config/knexfile.js migrate:latest
cd ../frontend && npm ci && npm run build
pm2 restart ibt-aqua
```

## 9. Mobile app

See `mobile/README.md`. Production builds use EAS: set `EXPO_PUBLIC_API_URL=https://www.ibtaqua.in/api` and `EXPO_PUBLIC_WEB_URL=https://www.ibtaqua.in`, then `eas build -p android`.
