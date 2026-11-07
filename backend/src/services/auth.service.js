const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const db = require('../database/db');
const env = require('../config/env');
const { sha256, randomToken, randomDigits, sqlTime, fromSqlTime } = require('../utils/helpers');
const { bad, unauthorized, forbidden, AppError } = require('../utils/errors');
const providers = require('./providers');
const { tierForRole, B2B_ROLES } = require('../config/rbac');

const BCRYPT_ROUNDS = 12;
const hashPassword = (p) => bcrypt.hash(p, BCRYPT_ROUNDS);

async function issueTokens(user, userAgent) {
  const access = jwt.sign({ sub: user.id, role: user.role, tv: user.token_version }, env.JWT_ACCESS_SECRET, { expiresIn: env.JWT_ACCESS_TTL });
  const refresh = randomToken();
  await db('refresh_tokens').insert({
    user_id: user.id, token_hash: sha256(refresh), user_agent: (userAgent || '').slice(0, 255),
    expires_at: sqlTime(Date.now() + env.REFRESH_TTL_DAYS * 86400e3),
  });
  await db('users').where({ id: user.id }).update({ last_login_at: db.fn.now() });
  return { accessToken: access, refreshToken: refresh };
}

async function profile(userId) {
  const u = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', userId)
    .first('u.id', 'u.name', 'u.phone', 'u.email', 'u.status', 'r.name as role', 'r.is_staff', 'u.created_at');
  if (!u) return null;
  u.tier = tierForRole(u.role);
  u.is_staff = !!u.is_staff;
  if (B2B_ROLES.includes(u.role)) {
    u.business = await db(`${u.role}s`).where({ user_id: u.id }).first();
  }
  if (u.role === 'delivery') u.delivery = await db('delivery_staff').where({ user_id: u.id }).first();
  const perms = await db('role_permissions as rp').join('permissions as p', 'p.id', 'rp.permission_id')
    .join('roles as r', 'r.id', 'rp.role_id').where('r.name', u.role).pluck('p.key');
  u.permissions = perms;
  return u;
}

const userWithRole = (where) => db('users as u').join('roles as r', 'r.id', 'u.role_id').where(where).first('u.*', 'r.name as role');

async function requestOtp(phone, purpose = 'login') {
  const exists = await db('users').where({ phone }).first('id');
  if (purpose === 'register' && exists) throw new AppError(409, 'This number is already registered. Log in with your password, or reset it with OTP.', 'CONFLICT');
  if (purpose === 'reset' && !exists) throw bad('No account with this number. Create a new account instead.');
  // Register and reset both verify through the 'login' code store so one OTP table serves all flows.
  purpose = purpose === 'reset' ? 'reset' : 'login';
  const recent = await db('otp_codes').where({ phone }).andWhere('created_at', '>', sqlTime(Date.now() - 3600e3)).count({ n: '*' }).first();
  if (recent.n >= 5) throw new AppError(429, 'Too many OTP requests. Try again in an hour.', 'RATE_LIMIT');
  const code = randomDigits(6);
  await db('otp_codes').where({ phone, purpose }).whereNull('consumed_at').update({ consumed_at: db.fn.now() });
  await db('otp_codes').insert({ phone, purpose, code_hash: await bcrypt.hash(code, 8), expires_at: sqlTime(Date.now() + env.OTP_TTL_MINUTES * 60e3) });
  await providers.sms(phone, `${code} is your IBT AQUA verification code. Valid for ${env.OTP_TTL_MINUTES} minutes. Do not share it.`);
  return { sent: true, isNewUser: !exists, ...(env.otpEcho ? { devOtp: code } : {}) };
}

async function consumeOtp(phone, code, purpose = 'login') {
  const otp = await db('otp_codes').where({ phone, purpose }).whereNull('consumed_at').orderBy('id', 'desc').first();
  if (!otp || fromSqlTime(otp.expires_at) < new Date()) throw bad('OTP expired. Please request a new one.');
  if (otp.attempts >= 5) throw bad('Too many wrong attempts. Please request a new OTP.');
  const ok = await bcrypt.compare(code, otp.code_hash);
  if (!ok) {
    await db('otp_codes').where({ id: otp.id }).increment('attempts', 1);
    throw bad('Incorrect OTP');
  }
  await db('otp_codes').where({ id: otp.id }).update({ consumed_at: db.fn.now() });
}

/** OTP login; creates a customer account on first login when a name is supplied. */
async function verifyOtp({ phone, code, name, email, password }, userAgent) {
  let user = await userWithRole({ 'u.phone': phone });
  // Ask for a name before consuming the code, so the same OTP works on the follow-up request.
  if (!user && !name) throw bad('Please enter your name to create an account', { needsName: true });
  await consumeOtp(phone, code);
  if (!user) {
    const role = await db('roles').where({ name: 'customer' }).first();
    await db.transaction(async (trx) => {
      const [id] = await trx('users').insert({ role_id: role.id, name, phone, email: email || null, password_hash: password ? await hashPassword(password) : null, status: 'active' });
      await trx('customers').insert({ user_id: id });
    });
    user = await userWithRole({ 'u.phone': phone });
  }
  if (['suspended', 'rejected'].includes(user.status)) throw forbidden('Account is not active');
  return { ...(await issueTokens(user, userAgent)), user: await profile(user.id) };
}

/** Forgot password: verify an OTP sent with purpose 'reset', set the new password, sign out other devices. */
async function resetPassword({ phone, code, password }, userAgent) {
  const user = await userWithRole({ 'u.phone': phone });
  if (!user) throw bad('No account with this number');
  await consumeOtp(phone, code, 'reset');
  await db('users').where({ id: user.id }).update({ password_hash: await hashPassword(password), token_version: user.token_version + 1 });
  await db('refresh_tokens').where({ user_id: user.id }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
  const fresh = await userWithRole({ 'u.id': user.id });
  if (['suspended', 'rejected'].includes(fresh.status)) throw forbidden('Account is not active');
  return { ...(await issueTokens(fresh, userAgent)), user: await profile(fresh.id) };
}

async function passwordLogin({ identifier, password }, userAgent) {
  const user = await userWithRole((q) => q.where('u.phone', identifier).orWhere('u.email', identifier.toLowerCase()));
  // Same message and timing for unknown user vs wrong password.
  const ok = await bcrypt.compare(password, user?.password_hash || '$2a$12$invalidinvalidinvalidinvalidinvalidinvalidinvalidinv');
  if (user && !user.password_hash) throw unauthorized('No password set for this account yet. Use "Forgot password" to set one with OTP.');
  if (!user || !ok) throw unauthorized('Incorrect phone/email or password');
  if (['suspended', 'rejected'].includes(user.status)) throw forbidden(user.status === 'rejected' ? 'Your application was not approved' : 'Account suspended');
  return { ...(await issueTokens(user, userAgent)), user: await profile(user.id) };
}

async function registerBusiness(roleName, data) {
  if (!B2B_ROLES.includes(roleName)) throw bad('Invalid business type');
  const role = await db('roles').where({ name: roleName }).first();
  const dup = await db('users').where({ phone: data.phone }).orWhere((q) => data.email && q.where({ email: data.email.toLowerCase() })).first();
  if (dup) throw new AppError(409, 'An account with this phone or email already exists. Log in instead.', 'CONFLICT');
  return db.transaction(async (trx) => {
    const [id] = await trx('users').insert({
      role_id: role.id, name: data.contactPerson, phone: data.phone, email: data.email?.toLowerCase() || null,
      password_hash: await hashPassword(data.password), status: 'pending',
    });
    await trx(`${roleName}s`).insert({
      user_id: id, business_name: data.businessName, gstin: data.gstin || null, pan: data.pan || null,
      contact_person: data.contactPerson, business_address: data.address, city: data.city, state: data.state, pincode: data.pincode,
    });
    return id;
  });
}

async function refresh(token, userAgent) {
  const row = await db('refresh_tokens').where({ token_hash: sha256(token) }).first();
  if (!row || row.revoked_at || fromSqlTime(row.expires_at) < new Date()) {
    // Reuse of a revoked token = likely theft: revoke the whole family.
    if (row?.revoked_at) await db('refresh_tokens').where({ user_id: row.user_id }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
    throw unauthorized('Session expired, please log in again');
  }
  await db('refresh_tokens').where({ id: row.id }).update({ revoked_at: db.fn.now() });
  const user = await userWithRole({ 'u.id': row.user_id });
  if (!user || ['suspended', 'rejected'].includes(user.status)) throw unauthorized();
  return issueTokens(user, userAgent);
}

async function logout(token) {
  if (token) await db('refresh_tokens').where({ token_hash: sha256(token) }).update({ revoked_at: db.fn.now() });
}

async function logoutAll(userId) {
  await db('users').where({ id: userId }).increment('token_version', 1);
  await db('refresh_tokens').where({ user_id: userId }).whereNull('revoked_at').update({ revoked_at: db.fn.now() });
}

module.exports = { hashPassword, requestOtp, verifyOtp, resetPassword, passwordLogin, registerBusiness, refresh, logout, logoutAll, profile, issueTokens };
