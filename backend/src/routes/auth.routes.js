const router = require('express').Router();
const rateLimit = require('express-rate-limit');
const env = require('../config/env');
const authService = require('../services/auth.service');
const db = require('../database/db');
const { requireAuth } = require('../middleware/auth');
const { validate } = require('../middleware/common');
const { docUpload, verifyMagic } = require('../middleware/upload');
const { ah, bad } = require('../utils/errors');
const v = require('../validators');

const strict = rateLimit({ windowMs: 15 * 60e3, limit: env.isTest ? 1000 : 20, standardHeaders: true, legacyHeaders: false, message: { error: { code: 'RATE_LIMIT', message: 'Too many attempts. Please wait a few minutes.' } } });

router.post('/otp/request', strict, validate({ body: v.auth.otpRequest }), ah(async (req, res) => res.json(await authService.requestOtp(req.body.phone, req.body.purpose))));
router.post('/password/reset', strict, validate({ body: v.auth.passwordReset }), ah(async (req, res) => res.json(await authService.resetPassword(req.body, req.get('user-agent')))));
router.post('/otp/verify', strict, validate({ body: v.auth.otpVerify }), ah(async (req, res) => res.json(await authService.verifyOtp(req.body, req.get('user-agent')))));
router.post('/login', strict, validate({ body: v.auth.login }), ah(async (req, res) => res.json(await authService.passwordLogin(req.body, req.get('user-agent')))));
router.post('/refresh', validate({ body: v.auth.refresh }), ah(async (req, res) => res.json(await authService.refresh(req.body.refreshToken, req.get('user-agent')))));
router.post('/logout', ah(async (req, res) => { await authService.logout(req.body?.refreshToken); res.json({ ok: true }); }));
router.post('/logout-all', requireAuth({ allowPending: true }), ah(async (req, res) => { await authService.logoutAll(req.user.id); res.json({ ok: true }); }));

router.post('/register/:type', strict, validate({ body: v.auth.business }), ah(async (req, res) => {
  if (!['retailer', 'wholesaler', 'distributor'].includes(req.params.type)) throw bad('Unknown business type');
  const id = await authService.registerBusiness(req.params.type, req.body);
  const user = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', id).first('u.*', 'r.name as role');
  // Pending accounts get a session so they can upload documents and see their status.
  res.status(201).json({ ...(await authService.issueTokens(user, req.get('user-agent'))), user: await authService.profile(id) });
}));

router.get('/me', requireAuth({ allowPending: true }), ah(async (req, res) => res.json({ user: await authService.profile(req.user.id) })));

router.patch('/me', requireAuth({ allowPending: true }), validate({ body: v.z.object({ name: v.z.string().trim().min(2).max(120).optional(), email: v.opt(v.email) }) }), ah(async (req, res) => {
  await db('users').where({ id: req.user.id }).update({ ...(req.body.name && { name: req.body.name }), ...(req.body.email !== undefined && { email: req.body.email || null }), updated_at: db.fn.now() });
  res.json({ user: await authService.profile(req.user.id) });
}));

router.post('/me/password', requireAuth({ allowPending: true }), validate({ body: v.z.object({ currentPassword: v.z.string().optional(), newPassword: v.password }) }), ah(async (req, res) => {
  const bcrypt = require('bcryptjs');
  const u = await db('users').where({ id: req.user.id }).first();
  if (u.password_hash && !(await bcrypt.compare(req.body.currentPassword || '', u.password_hash))) throw bad('Current password is incorrect');
  await db('users').where({ id: u.id }).update({ password_hash: await authService.hashPassword(req.body.newPassword), token_version: u.token_version + 1 });
  res.json({ ok: true, message: 'Password changed. Please log in again on other devices.' });
}));

// B2B KYC documents
router.post('/me/documents', requireAuth({ allowPending: true }), docUpload.single('file'), verifyMagic, ah(async (req, res) => {
  if (!req.file) throw bad('Choose a file to upload');
  const docType = v.z.enum(['gst_certificate', 'pan', 'trade_license', 'fssai', 'shop_photo', 'other']).parse(req.body.docType);
  const [id] = await db('business_documents').insert({ user_id: req.user.id, doc_type: docType, file_path: `documents/${req.file.filename}`, original_name: req.file.originalname.slice(0, 255), mime: req.file.mimetype, size_bytes: req.file.size });
  res.status(201).json(await db('business_documents').where({ id }).first());
}));
router.get('/me/documents', requireAuth({ allowPending: true }), ah(async (req, res) => res.json(await db('business_documents').where({ user_id: req.user.id }).orderBy('id', 'desc'))));

module.exports = router;
