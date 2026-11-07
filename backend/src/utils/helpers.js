const crypto = require('crypto');

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');
const randomToken = (bytes = 48) => crypto.randomBytes(bytes).toString('base64url');
const randomDigits = (n = 6) => String(crypto.randomInt(0, 10 ** n)).padStart(n, '0');

const parseJSON = (v, fallback = null) => {
  if (v == null) return fallback;
  if (typeof v !== 'string') return v;
  try { return JSON.parse(v); } catch { return fallback; }
};

// Indian date (IST) helpers — the business runs in Asia/Kolkata.
const todayIST = (d = new Date()) => new Date(d.getTime() + 5.5 * 3600e3).toISOString().slice(0, 10);
const addDays = (isoDate, n) => {
  const d = new Date(`${isoDate}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
};

// Money is integer paise everywhere.
const pct = (amount, percent) => Math.round((amount * Number(percent)) / 100);
const rupees = (paise) => `₹${(paise / 100).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** Split a GST-inclusive amount into taxable + tax. */
const splitInclusive = (gross, gstPercent) => {
  const taxable = Math.round((gross * 100) / (100 + Number(gstPercent)));
  return { taxable, gst: gross - taxable };
};

const genNumber = (prefix) => {
  const d = todayIST().replace(/-/g, '').slice(2);
  return `${prefix}${d}${randomDigits(5)}`;
};

const paginate = (q) => {
  const page = Math.max(1, parseInt(q.page, 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(q.limit, 10) || 20));
  return { page, limit, offset: (page - 1) * limit };
};

const slugify = (s) => String(s).toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');

// SQLite CURRENT_TIMESTAMP format (UTC, 'YYYY-MM-DD HH:MM:SS'). Use for every timestamp we write
// so string comparisons in SQL stay correct.
const sqlTime = (d = new Date()) => new Date(d).toISOString().replace('T', ' ').slice(0, 19);
const fromSqlTime = (s) => (s ? new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}Z`) : null);

module.exports = { sqlTime, fromSqlTime, sha256, randomToken, randomDigits, parseJSON, todayIST, addDays, pct, rupees, splitInclusive, genNumber, paginate, slugify };
