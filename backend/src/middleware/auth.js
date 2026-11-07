const jwt = require('jsonwebtoken');
const env = require('../config/env');
const db = require('../database/db');
const { unauthorized, forbidden } = require('../utils/errors');
const { tierForRole, B2B_ROLES } = require('../config/rbac');

let permCache = null;
async function permissionsFor(roleId) {
  if (!permCache) {
    const rows = await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id').select('rp.role_id', 'p.key');
    permCache = new Map();
    for (const r of rows) {
      if (!permCache.has(r.role_id)) permCache.set(r.role_id, new Set());
      permCache.get(r.role_id).add(r.key);
    }
  }
  return permCache.get(roleId) || new Set();
}
const clearPermCache = () => { permCache = null; };

async function loadUser(token) {
  let payload;
  try { payload = jwt.verify(token, env.JWT_ACCESS_SECRET); } catch { return null; }
  const user = await db('users as u').join('roles as r', 'r.id', 'u.role_id')
    .where('u.id', payload.sub)
    .first('u.id', 'u.name', 'u.phone', 'u.email', 'u.status', 'u.role_id', 'u.token_version', 'r.name as role');
  if (!user || user.token_version !== payload.tv) return null;
  user.tier = tierForRole(user.role);
  user.permissions = await permissionsFor(user.role_id);
  return user;
}

const bearer = (req) => {
  const h = req.headers.authorization || '';
  return h.startsWith('Bearer ') ? h.slice(7) : null;
};

/** Requires a valid token and an active (or pending-B2B, if allowed) account. */
const requireAuth = (opts = {}) => async (req, res, next) => {
  try {
    const token = bearer(req);
    if (!token) throw unauthorized();
    const user = await loadUser(token);
    if (!user) throw unauthorized('Session expired, please log in again');
    if (user.status === 'suspended' || user.status === 'rejected') throw forbidden('Account is not active');
    if (user.status === 'pending' && !opts.allowPending) throw forbidden('Your business account is awaiting admin approval');
    req.user = user;
    next();
  } catch (e) { next(e); }
};

/** Attaches req.user when a valid token is present; never fails. Used for pricing on public catalog. */
const optionalAuth = async (req, res, next) => {
  const token = bearer(req);
  if (token) {
    const user = await loadUser(token).catch(() => null);
    if (user && user.status === 'active') req.user = user;
  }
  next();
};

const requireRole = (...roles) => (req, res, next) => {
  if (!req.user || !roles.includes(req.user.role)) return next(forbidden());
  next();
};

const requirePerm = (...perms) => (req, res, next) => {
  if (!req.user) return next(unauthorized());
  if (!perms.every((p) => req.user.permissions.has(p))) return next(forbidden());
  next();
};

const requireB2B = requireRole(...B2B_ROLES);

module.exports = { requireAuth, optionalAuth, requireRole, requirePerm, requireB2B, clearPermCache };
