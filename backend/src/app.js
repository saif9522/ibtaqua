const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cors = require('cors');
const morgan = require('morgan');
const rateLimit = require('express-rate-limit');
const env = require('./config/env');
const payments = require('./services/payment.service');
const { requireAuth, requireRole } = require('./middleware/auth');
const { notFoundHandler, errorHandler } = require('./middleware/common');
const { ah } = require('./utils/errors');

const app = express();
app.set('trust proxy', 1);
app.disable('x-powered-by');

app.use(helmet({ crossOriginResourcePolicy: { policy: 'cross-origin' } }));
const origins = env.CORS_ORIGINS.split(',').map((s) => s.trim()).filter(Boolean);
app.use(cors({
  origin: (origin, cb) => (!origin || origins.includes(origin) ? cb(null, true) : cb(null, false)),
  credentials: false,
  methods: ['GET', 'POST', 'PUT', 'PATCH', 'DELETE'],
}));
if (!env.isTest) app.use(morgan(env.isProd ? 'combined' : 'dev'));

// Razorpay webhook needs the raw bytes for HMAC verification — mount before JSON parsing.
app.post('/api/webhooks/razorpay', express.raw({ type: 'application/json', limit: '1mb' }), ah(async (req, res) => {
  res.json(await payments.handleWebhook(req.body, req.get('x-razorpay-signature')));
}));

app.use(express.json({ limit: '1mb' }));
app.use('/api', rateLimit({ windowMs: 60e3, limit: env.isTest ? 100000 : 300, standardHeaders: true, legacyHeaders: false }));

// Only product and CMS images are public. KYC documents are served through an authorised route.
for (const sub of ['products', 'cms']) {
  app.use(`/uploads/${sub}`, express.static(path.join(env.uploadDir, sub), { maxAge: '7d', index: false, dotfiles: 'deny' }));
}

app.get('/api/health', (req, res) => res.json({ ok: true, time: new Date().toISOString() }));
app.use('/api/auth', require('./routes/auth.routes'));
app.use('/api', require('./routes/public.routes'));
app.use('/api/account', require('./routes/account.routes'));
app.use('/api/delivery', require('./routes/delivery.routes'));

const admin = express.Router();
admin.use(requireAuth(), requireRole('super_admin', 'admin'));
admin.use(require('./routes/admin/system.routes'));
admin.use(require('./routes/admin/users.routes'));
admin.use(require('./routes/admin/catalog.routes'));
admin.use(require('./routes/admin/operations.routes'));
app.use('/api/admin', admin);

app.use('/api', notFoundHandler);

// In production the built web app can be served from the same origin.
const webDist = path.resolve(__dirname, '../../frontend/dist');
if (env.isProd) {
  app.use(express.static(webDist, { index: false, maxAge: '1h' }));
  app.get(/^\/(?!api|uploads).*/, (req, res) => res.sendFile(path.join(webDist, 'index.html')));
}

app.use(errorHandler);
module.exports = app;
