const router = require('express').Router();
const path = require('path');
const db = require('../../database/db');
const env = require('../../config/env');
const audit = require('../../services/audit.service');
const authService = require('../../services/auth.service');
const notify = require('../../services/notification.service');
const orders = require('../../services/order.service');
const { requirePerm } = require('../../middleware/auth');
const { validate } = require('../../middleware/common');
const { ah, notFound, bad, conflict } = require('../../utils/errors');
const { paginate } = require('../../utils/helpers');
const { B2B_ROLES } = require('../../config/rbac');
const v = require('../../validators');

const ROLE_PARAM = ['customer', 'retailer', 'wholesaler', 'distributor', 'delivery', 'admin', 'super_admin'];

// GET /admin/users?role=retailer&status=pending&search=
router.get('/users', requirePerm('users.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const role = String(req.query.role || 'customer');
  if (!ROLE_PARAM.includes(role)) throw bad('Unknown role');
  const q = db('users as u').join('roles as r', 'r.id', 'u.role_id').where('r.name', role);
  if (B2B_ROLES.includes(role)) q.leftJoin(`${role}s as b`, 'b.user_id', 'u.id');
  if (req.query.status) q.andWhere('u.status', String(req.query.status));
  if (req.query.search) {
    const s = `%${String(req.query.search).toLowerCase()}%`;
    q.andWhere((w) => {
      w.whereRaw('LOWER(u.name) LIKE ?', [s]).orWhere('u.phone', 'like', s).orWhereRaw('LOWER(u.email) LIKE ?', [s]);
      if (B2B_ROLES.includes(role)) w.orWhereRaw('LOWER(b.business_name) LIKE ?', [s]).orWhereRaw('LOWER(b.gstin) LIKE ?', [s]);
    });
  }
  const total = (await q.clone().count({ n: '*' }).first()).n;
  const cols = ['u.id', 'u.name', 'u.phone', 'u.email', 'u.status', 'u.created_at', 'u.last_login_at', 'r.name as role',
    db.raw('(SELECT COUNT(*) FROM orders o WHERE o.user_id = u.id) as order_count'),
    db.raw("(SELECT COALESCE(SUM(grand_total),0) FROM orders o WHERE o.user_id = u.id AND o.status NOT IN ('cancelled','returned')) as lifetime_value")];
  if (B2B_ROLES.includes(role)) cols.push('b.business_name', 'b.gstin', 'b.city', 'b.approval_status', 'b.credit_enabled', 'b.credit_limit',
    db.raw("(SELECT COALESCE(SUM(grand_total - amount_paid),0) FROM orders o WHERE o.user_id = u.id AND o.payment_method='credit' AND o.status NOT IN ('cancelled','returned')) as outstanding"));
  if (role === 'delivery') {
    q.leftJoin('delivery_staff as ds', 'ds.user_id', 'u.id').leftJoin('delivery_zones as z', 'z.id', 'ds.zone_id');
    cols.push('ds.id as staff_id', 'ds.vehicle_number', 'ds.is_available', 'z.name as zone_name', 'ds.zone_id');
  }
  const rows = await q.select(cols).orderBy('u.id', 'desc').limit(limit).offset(offset);
  res.json({ data: rows, page, limit, total });
}));

router.get('/users/:id', requirePerm('users.read'), ah(async (req, res) => {
  const u = await authService.profile(Number(req.params.id));
  if (!u) throw notFound('User');
  u.addresses = await db('user_addresses').where({ user_id: u.id });
  u.documents = await db('business_documents').where({ user_id: u.id }).orderBy('id', 'desc');
  u.jarBalance = await db('jar_balances').where({ user_id: u.id }).first();
  u.recentOrders = await db('orders').where({ user_id: u.id }).orderBy('id', 'desc').limit(10).select('id', 'order_number', 'status', 'grand_total', 'payment_status', 'created_at');
  u.outstanding = await orders.outstandingFor(db, u.id);
  u.creditRequests = await db('credit_requests').where({ user_id: u.id }).orderBy('id', 'desc');
  u.negotiatedPrices = await db('product_prices as pp').join('products as p', 'p.id', 'pp.product_id').where('pp.user_id', u.id).select('pp.*', 'p.name as product_name');
  if (u.role === 'distributor') u.zones = await db('distributor_zones').where({ user_id: u.id }).pluck('zone_id');
  res.json(u);
}));

// Create a buyer or delivery user from the admin panel (phone orders, onboarding offline partners).
router.post('/users', requirePerm('users.write'), validate({ body: v.z.object({
  role: v.z.enum(['customer', 'retailer', 'wholesaler', 'distributor', 'delivery']), name: v.z.string().trim().min(2), phone: v.phone, email: v.opt(v.email),
  password: v.opt(v.password), businessName: v.opt(v.z.string().min(2)), gstin: v.opt(v.gstin), city: v.opt(v.z.string()), state: v.opt(v.z.string()), pincode: v.opt(v.pincode),
  address: v.opt(v.z.string()), vehicleNumber: v.opt(v.z.string().max(20)), zoneId: v.id.optional(),
}) }), ah(async (req, res) => {
  const b = req.body;
  if (B2B_ROLES.includes(b.role) && !b.businessName) throw bad('Business name is required');
  if (b.role === 'delivery' && !b.password) throw bad('Set a password for delivery staff');
  const role = await db('roles').where({ name: b.role }).first();
  const id = await db.transaction(async (trx) => {
    const [uid] = await trx('users').insert({ role_id: role.id, name: b.name, phone: b.phone, email: b.email || null, password_hash: b.password ? await authService.hashPassword(b.password) : null, status: 'active' });
    if (b.role === 'customer') await trx('customers').insert({ user_id: uid });
    if (B2B_ROLES.includes(b.role)) await trx(`${b.role}s`).insert({ user_id: uid, business_name: b.businessName, gstin: b.gstin || null, contact_person: b.name, business_address: b.address, city: b.city, state: b.state, pincode: b.pincode, approval_status: 'approved', approved_by: req.user.id, approved_at: trx.fn.now() });
    if (b.role === 'delivery') await trx('delivery_staff').insert({ user_id: uid, vehicle_number: b.vehicleNumber || null, zone_id: b.zoneId || null });
    await audit.log(req, 'user.create', 'user', uid, { role: b.role }, trx);
    return uid;
  });
  res.status(201).json(await authService.profile(id));
}));

router.patch('/users/:id', requirePerm('users.write'), validate({ body: v.z.object({
  name: v.z.string().trim().min(2).optional(), email: v.opt(v.email), status: v.z.enum(['active', 'suspended']).optional(),
  business: v.z.object({ businessName: v.z.string().min(2).optional(), gstin: v.opt(v.gstin), pan: v.opt(v.pan), city: v.z.string().optional(), state: v.z.string().optional(), pincode: v.opt(v.pincode), businessAddress: v.z.string().optional(), creditEnabled: v.z.boolean().optional(), creditLimit: v.paise.optional(), creditDays: v.z.coerce.number().int().min(0).max(180).optional(), agreementRef: v.opt(v.z.string().max(80)), agreementValidTo: v.opt(v.isoDate) }).optional(),
  delivery: v.z.object({ vehicleNumber: v.opt(v.z.string().max(20)), zoneId: v.id.nullable().optional() }).optional(),
  zones: v.z.array(v.id).optional(),
}) }), ah(async (req, res) => {
  const u = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', req.params.id).first('u.*', 'r.name as role');
  if (!u) throw notFound('User');
  if (u.role === 'super_admin' && req.user.role !== 'super_admin') throw bad('Cannot edit a super admin');
  if (u.id === req.user.id && req.body.status === 'suspended') throw bad('You cannot suspend yourself');
  await db.transaction(async (trx) => {
    const up = {};
    if (req.body.name) up.name = req.body.name;
    if (req.body.email !== undefined) up.email = req.body.email || null;
    if (req.body.status) { up.status = req.body.status; if (req.body.status === 'suspended') up.token_version = u.token_version + 1; }
    if (Object.keys(up).length) await trx('users').where({ id: u.id }).update({ ...up, updated_at: trx.fn.now() });
    const b = req.body.business;
    if (b && B2B_ROLES.includes(u.role)) {
      const map = { businessName: 'business_name', gstin: 'gstin', pan: 'pan', city: 'city', state: 'state', pincode: 'pincode', businessAddress: 'business_address', creditEnabled: 'credit_enabled', creditLimit: 'credit_limit', creditDays: 'credit_days' };
      if (u.role === 'distributor') Object.assign(map, { agreementRef: 'agreement_ref', agreementValidTo: 'agreement_valid_to' });
      const bu = Object.fromEntries(Object.entries(b).filter(([k]) => map[k]).map(([k, val]) => [map[k], val ?? null]));
      if (Object.keys(bu).length) await trx(`${u.role}s`).where({ user_id: u.id }).update({ ...bu, updated_at: trx.fn.now() });
    }
    if (req.body.delivery && u.role === 'delivery') await trx('delivery_staff').where({ user_id: u.id }).update({ vehicle_number: req.body.delivery.vehicleNumber ?? null, zone_id: req.body.delivery.zoneId ?? null });
    if (req.body.zones && u.role === 'distributor') {
      await trx('distributor_zones').where({ user_id: u.id }).del();
      if (req.body.zones.length) await trx('distributor_zones').insert(req.body.zones.map((z) => ({ user_id: u.id, zone_id: z })));
    }
    await audit.log(req, 'user.update', 'user', u.id, req.body, trx);
  });
  res.json(await authService.profile(u.id));
}));

router.post('/users/:id/reset-password', requirePerm('users.write'), validate({ body: v.z.object({ password: v.password }) }), ah(async (req, res) => {
  const u = await db('users').where({ id: req.params.id }).first();
  if (!u) throw notFound('User');
  await db('users').where({ id: u.id }).update({ password_hash: await authService.hashPassword(req.body.password), token_version: u.token_version + 1 });
  await audit.log(req, 'user.password_reset', 'user', u.id);
  res.json({ ok: true });
}));

// ---------- Partner approval ----------
router.post('/users/:id/approval', requirePerm('partners.approve'), validate({ body: v.z.object({ decision: v.z.enum(['approved', 'rejected']), reason: v.opt(v.z.string().max(300)), creditLimit: v.paise.optional(), creditDays: v.z.coerce.number().int().min(0).max(180).optional() }) }), ah(async (req, res) => {
  const u = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', req.params.id).first('u.*', 'r.name as role');
  if (!u || !B2B_ROLES.includes(u.role)) throw notFound('Business account');
  if (req.body.decision === 'rejected' && !req.body.reason) throw bad('Please give a reason for rejection');
  await db.transaction(async (trx) => {
    const ok = req.body.decision === 'approved';
    await trx(`${u.role}s`).where({ user_id: u.id }).update({
      approval_status: req.body.decision, rejection_reason: ok ? null : req.body.reason, approved_by: req.user.id, approved_at: trx.fn.now(),
      ...(req.body.creditLimit !== undefined && { credit_limit: req.body.creditLimit, credit_enabled: req.body.creditLimit > 0 }),
      ...(req.body.creditDays !== undefined && { credit_days: req.body.creditDays }),
    });
    await trx('users').where({ id: u.id }).update({ status: ok ? 'active' : 'rejected' });
    await trx('business_documents').where({ user_id: u.id, status: 'pending' }).update({ status: ok ? 'verified' : 'rejected' });
    await notify.toUser(trx, u.id, { type: 'account', title: ok ? 'Your business account is approved' : 'Application not approved', body: ok ? 'You can now order at your partner prices.' : req.body.reason });
    await audit.log(req, `partner.${req.body.decision}`, 'user', u.id, req.body, trx);
  });
  res.json(await authService.profile(u.id));
}));

router.get('/documents/:id/file', requirePerm('users.read'), ah(async (req, res) => {
  const d = await db('business_documents').where({ id: req.params.id }).first();
  if (!d) throw notFound('Document');
  const file = path.join(env.uploadDir, d.file_path);
  if (!file.startsWith(env.uploadDir)) throw bad('Invalid path');
  res.setHeader('Content-Type', d.mime);
  res.setHeader('Content-Disposition', `inline; filename="${(d.original_name || 'document').replace(/"/g, '')}"`);
  res.sendFile(file);
}));
router.patch('/documents/:id', requirePerm('partners.approve'), validate({ body: v.z.object({ status: v.z.enum(['verified', 'rejected', 'pending']) }) }), ah(async (req, res) => {
  await db('business_documents').where({ id: req.params.id }).update({ status: req.body.status });
  res.json({ ok: true });
}));

router.get('/credit-requests', requirePerm('partners.approve'), ah(async (req, res) => res.json(await db('credit_requests as c').join('users as u', 'u.id', 'c.user_id').join('roles as r', 'r.id', 'u.role_id')
  .where((q) => (req.query.status ? q.where('c.status', String(req.query.status)) : q)).orderBy('c.id', 'desc').select('c.*', 'u.name', 'u.phone', 'r.name as role'))));
router.post('/credit-requests/:id', requirePerm('partners.approve'), validate({ body: v.z.object({ decision: v.z.enum(['approved', 'rejected']), approvedLimit: v.paise.optional(), creditDays: v.z.coerce.number().int().min(0).max(180).optional(), note: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  const c = await db('credit_requests as c').join('users as u', 'u.id', 'c.user_id').join('roles as r', 'r.id', 'u.role_id').where('c.id', req.params.id).first('c.*', 'r.name as role');
  if (!c) throw notFound('Credit request');
  if (c.status !== 'pending') throw conflict('Already decided');
  await db.transaction(async (trx) => {
    await trx('credit_requests').where({ id: c.id }).update({ status: req.body.decision, decided_by: req.user.id, decision_note: req.body.note || null, updated_at: trx.fn.now() });
    if (req.body.decision === 'approved') {
      await trx(`${c.role}s`).where({ user_id: c.user_id }).update({ credit_enabled: true, credit_limit: req.body.approvedLimit ?? c.requested_limit, ...(req.body.creditDays !== undefined && { credit_days: req.body.creditDays }) });
    }
    await notify.toUser(trx, c.user_id, { type: 'account', title: `Credit request ${req.body.decision}`, body: req.body.note || '' });
    await audit.log(req, `credit.${req.body.decision}`, 'credit_request', c.id, req.body, trx);
  });
  res.json({ ok: true });
}));

// ---------- Staff admins ----------
router.get('/admins', requirePerm('admins.manage'), ah(async (req, res) => res.json(await db('users as u').join('roles as r', 'r.id', 'u.role_id').whereIn('r.name', ['super_admin', 'admin']).select('u.id', 'u.name', 'u.phone', 'u.email', 'u.status', 'u.last_login_at', 'r.name as role'))));
router.post('/admins', requirePerm('admins.manage'), validate({ body: v.z.object({ name: v.z.string().min(2), phone: v.phone, email: v.email, password: v.password, role: v.z.enum(['admin', 'super_admin']) }) }), ah(async (req, res) => {
  const role = await db('roles').where({ name: req.body.role }).first();
  const [id] = await db('users').insert({ role_id: role.id, name: req.body.name, phone: req.body.phone, email: req.body.email, password_hash: await authService.hashPassword(req.body.password) });
  await audit.log(req, 'admin.create', 'user', id, { role: req.body.role });
  res.status(201).json({ id });
}));

module.exports = router;
