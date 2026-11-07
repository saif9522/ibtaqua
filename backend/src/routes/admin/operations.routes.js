const router = require('express').Router();
const db = require('../../database/db');
const audit = require('../../services/audit.service');
const orders = require('../../services/order.service');
const payments = require('../../services/payment.service');
const delivery = require('../../services/delivery.service');
const jars = require('../../services/jar.service');
const subs = require('../../services/subscription.service');
const invoices = require('../../services/invoice.service');
const inventory = require('../../services/inventory.service');
const authService = require('../../services/auth.service');
const { requirePerm } = require('../../middleware/auth');
const { validate } = require('../../middleware/common');
const { ah, notFound, bad, conflict } = require('../../utils/errors');
const { paginate, parseJSON, todayIST } = require('../../utils/helpers');
const v = require('../../validators');

// ---------- Orders ----------
router.get('/orders', requirePerm('orders.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('orders as o').join('users as u', 'u.id', 'o.user_id').leftJoin('delivery_zones as z', 'z.id', 'o.zone_id');
  for (const k of ['status', 'payment_status', 'payment_method', 'buyer_tier']) if (req.query[k]) q.andWhere(`o.${k}`, String(req.query[k]));
  if (req.query.zoneId) q.andWhere('o.zone_id', Number(req.query.zoneId));
  if (req.query.from) q.andWhereRaw("date(datetime(o.created_at, '+330 minutes')) >= ?", [String(req.query.from)]);
  if (req.query.to) q.andWhereRaw("date(datetime(o.created_at, '+330 minutes')) <= ?", [String(req.query.to)]);
  if (req.query.deliveryDate) q.andWhere('o.delivery_date', String(req.query.deliveryDate));
  if (req.query.unassigned === 'true') q.whereNotExists(db('delivery_assignments as da').whereRaw('da.order_id = o.id').whereIn('da.status', ['assigned', 'picked_up', 'out_for_delivery', 'delivered']));
  if (req.query.search) {
    const s = `%${String(req.query.search).toLowerCase()}%`;
    q.andWhere((w) => w.whereRaw('LOWER(o.order_number) LIKE ?', [s]).orWhereRaw('LOWER(u.name) LIKE ?', [s]).orWhere('u.phone', 'like', s));
  }
  const total = (await q.clone().count({ n: '*' }).first()).n;
  const rows = await q.select('o.id', 'o.order_number', 'o.status', 'o.buyer_tier', 'o.payment_method', 'o.payment_status', 'o.grand_total', 'o.amount_paid', 'o.created_at',
    'o.delivery_date', 'o.delivery_slot', 'o.source', 'u.name as buyer_name', 'u.phone as buyer_phone', 'z.name as zone_name',
    db.raw("(SELECT u2.name FROM delivery_assignments da JOIN delivery_staff ds ON ds.id = da.staff_id JOIN users u2 ON u2.id = ds.user_id WHERE da.order_id = o.id AND da.status NOT IN ('reassigned','failed') ORDER BY da.id DESC LIMIT 1) as driver"),
    db.raw('(SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = o.id) as item_count'))
    .orderBy('o.id', 'desc').limit(limit).offset(offset);
  res.json({ data: rows, page, limit, total, transitions: orders.TRANSITIONS });
}));
router.get('/orders/:id', requirePerm('orders.read'), ah(async (req, res) => {
  const o = await orders.getOrderDetail(Number(req.params.id), req.user);
  o.allowedTransitions = orders.TRANSITIONS[o.status];
  o.batches = await db('order_item_batches as ob').join('order_items as oi', 'oi.id', 'ob.order_item_id').join('inventory_batches as b', 'b.id', 'ob.batch_id')
    .where('oi.order_id', o.id).select('oi.product_name', 'b.batch_number', 'b.expiry_date', 'ob.quantity');
  res.json(o);
}));
router.post('/orders/:id/status', requirePerm('orders.write'), validate({ body: v.z.object({ status: v.z.string(), note: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  const o = await orders.updateStatus(Number(req.params.id), req.body.status, req.user, req.body.note);
  await audit.log(req, 'order.status', 'order', o.id, req.body);
  res.json(o);
}));
router.post('/orders/bulk-status', requirePerm('orders.write'), validate({ body: v.z.object({ ids: v.z.array(v.id).min(1).max(200), status: v.z.string() }) }), ah(async (req, res) => {
  const results = [];
  for (const id of req.body.ids) {
    try { await orders.updateStatus(id, req.body.status, req.user); results.push({ id, ok: true }); } catch (e) { results.push({ id, ok: false, message: e.message }); }
  }
  await audit.log(req, 'order.bulk_status', 'order', null, req.body);
  res.json({ results });
}));
// Phone / counter orders placed by staff on behalf of a buyer.
router.post('/orders', requirePerm('orders.write'), validate({ body: v.checkout.place.extend({ userId: v.id }) }), ah(async (req, res) => {
  const u = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', req.body.userId).first('u.id', 'u.name', 'u.status', 'r.name as role');
  if (!u || !['customer', 'retailer', 'wholesaler', 'distributor'].includes(u.role)) throw notFound('Buyer');
  u.tier = require('../../config/rbac').tierForRole(u.role);
  const o = await orders.placeOrder(u, { ...req.body, source: 'admin' });
  await audit.log(req, 'order.create_for_buyer', 'order', o.id, { userId: u.id });
  res.status(201).json(o);
}));
router.post('/orders/:id/assign', requirePerm('delivery.manage'), validate({ body: v.z.object({ staffId: v.id }) }), ah(async (req, res) => {
  await delivery.assign(req.user, { orderIds: [Number(req.params.id)], staffId: req.body.staffId });
  await audit.log(req, 'delivery.assign', 'order', req.params.id, req.body);
  res.json({ ok: true });
}));
router.post('/delivery/assign', requirePerm('delivery.manage'), validate({ body: v.z.object({ orderIds: v.z.array(v.id).min(1).max(100), staffId: v.id }) }), ah(async (req, res) => {
  const n = await delivery.assign(req.user, req.body);
  await audit.log(req, 'delivery.assign_bulk', 'delivery_staff', req.body.staffId, req.body);
  res.json({ assigned: n });
}));
router.get('/orders/:id/invoice.pdf', requirePerm('orders.read'), ah(async (req, res) => {
  const inv = await db('invoices').where({ order_id: req.params.id }).first();
  if (!inv) throw bad('No invoice yet');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `inline; filename="${inv.invoice_number.replace(/\//g, '-')}.pdf"`);
  await invoices.renderPdf(Number(req.params.id), res);
}));
router.post('/orders/:id/invoice', requirePerm('orders.write'), ah(async (req, res) => {
  const o = await db('orders').where({ id: req.params.id }).first();
  if (!o) throw notFound('Order');
  if (['pending', 'cancelled'].includes(o.status)) throw bad('Invoices are issued for confirmed orders only');
  res.json(await db.transaction((trx) => invoices.ensureInvoice(trx, o.id)));
}));

// ---------- Returns ----------
router.get('/returns', requirePerm('support.manage'), ah(async (req, res) => res.json(await db('return_requests as r').join('orders as o', 'o.id', 'r.order_id').join('users as u', 'u.id', 'r.user_id')
  .where((q) => (req.query.status ? q.where('r.status', String(req.query.status)) : q)).orderBy('r.id', 'desc').select('r.*', 'o.order_number', 'o.grand_total', 'o.amount_paid', 'u.name', 'u.phone'))));
router.post('/returns/:id', requirePerm('support.manage'), validate({ body: v.z.object({ decision: v.z.enum(['approved', 'rejected']), restock: v.z.boolean().default(false), refundAmount: v.paise.default(0), note: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  const r = await db('return_requests').where({ id: req.params.id }).first();
  if (!r) throw notFound('Return');
  if (r.status !== 'requested') throw conflict('Already decided');
  await db.transaction(async (trx) => {
    if (req.body.decision === 'rejected') {
      await orders.transition(trx, r.order_id, 'delivered', req.user, `Return rejected: ${req.body.note || ''}`);
    } else {
      await orders.transition(trx, r.order_id, 'returned', req.user, req.body.note);
      const items = await trx('order_items').where({ order_id: r.order_id });
      for (const it of items) {
        if (req.body.restock) await inventory.restockItem(trx, it, r.order_id);
        else await trx('stock_movements').insert({ product_id: it.product_id, type: 'damage', quantity: 0, note: `Returned (not restocked) ${it.quantity} units`, reference_type: 'order', reference_id: String(r.order_id), created_by: req.user.id });
      }
    }
    await trx('return_requests').where({ id: r.id }).update({ status: req.body.decision === 'approved' ? 'completed' : 'rejected', refund_amount: req.body.refundAmount, admin_note: req.body.note || null, updated_at: trx.fn.now() });
    await audit.log(req, `return.${req.body.decision}`, 'return', r.id, req.body, trx);
  });
  // Refund against the order's captured payments, largest first.
  let left = req.body.decision === 'approved' ? req.body.refundAmount : 0;
  const pays = await db('payments').where({ order_id: r.order_id }).whereIn('status', ['captured', 'partially_refunded']).orderBy('amount', 'desc');
  for (const p of pays) {
    if (!left) break;
    const amt = Math.min(left, p.amount - p.refunded_amount);
    if (amt > 0) { await payments.refund(req.user, p.id, amt, 'Return approved'); left -= amt; }
  }
  res.json({ ok: true, unrefunded: left });
}));

// ---------- Payments ----------
router.get('/payments', requirePerm('payments.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('payments as p').leftJoin('orders as o', 'o.id', 'p.order_id').join('users as u', 'u.id', 'p.user_id');
  if (req.query.status) q.where('p.status', String(req.query.status));
  if (req.query.method) q.andWhere('p.method', String(req.query.method));
  if (req.query.search) q.andWhere((w) => w.where('o.order_number', 'like', `%${req.query.search}%`).orWhere('p.reference_no', 'like', `%${req.query.search}%`).orWhere('p.provider_payment_id', 'like', `%${req.query.search}%`));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  res.json({ data: await q.select('p.*', 'o.order_number', 'u.name as payer', 'u.phone').orderBy('p.id', 'desc').limit(limit).offset(offset), page, limit, total, gatewayLive: payments.isLive() });
}));
router.get('/payments/:id', requirePerm('payments.read'), ah(async (req, res) => {
  const p = await db('payments').where({ id: req.params.id }).first();
  if (!p) throw notFound('Payment');
  p.transactions = (await db('payment_transactions').where({ payment_id: p.id }).orderBy('id')).map((t) => ({ ...t, payload: parseJSON(t.payload) }));
  res.json(p);
}));
router.post('/payments/:id/verify', requirePerm('payments.write'), validate({ body: v.z.object({ approve: v.z.boolean(), note: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  await payments.verifyOffline(req.user, Number(req.params.id), req.body.approve, req.body.note);
  await audit.log(req, req.body.approve ? 'payment.approve' : 'payment.reject', 'payment', req.params.id, req.body);
  res.json({ ok: true });
}));
router.post('/payments/:id/refund', requirePerm('payments.write'), validate({ body: v.z.object({ amount: v.paise.refine((x) => x > 0), reason: v.z.string().trim().min(3).max(300) }) }), ah(async (req, res) => {
  await payments.refund(req.user, Number(req.params.id), req.body.amount, req.body.reason);
  await audit.log(req, 'payment.refund', 'payment', req.params.id, req.body);
  res.json({ ok: true });
}));
router.post('/payments/cash', requirePerm('payments.write'), validate({ body: v.z.object({ orderId: v.id, amount: v.paise.refine((x) => x > 0) }) }), ah(async (req, res) => {
  const id = await db.transaction((trx) => payments.recordCash(trx, { ...req.body, by: req.user.id }));
  await audit.log(req, 'payment.cash', 'payment', id, req.body);
  res.status(201).json({ id });
}));
router.post('/payments/credit-settlement', requirePerm('payments.write'), validate({ body: v.z.object({ userId: v.id, amount: v.paise.refine((x) => x > 0), method: v.z.enum(['bank_transfer', 'upi', 'cash', 'cheque']), referenceNo: v.opt(v.z.string().max(80)) }) }), ah(async (req, res) => {
  const id = await payments.recordCreditSettlement(req.user, req.body);
  await audit.log(req, 'payment.credit_settlement', 'payment', id, req.body);
  res.status(201).json({ id });
}));
// Reconciliation: gateway attempts stuck in "created" and paid totals that don't match payments.
router.get('/payments-reconciliation', requirePerm('payments.read'), ah(async (req, res) => {
  const stale = await db('payments').where('status', 'created').andWhere('created_at', '<', db.raw("datetime('now', '-30 minutes')")).select('id', 'order_id', 'amount', 'provider_order_id', 'created_at');
  const net = "(SELECT COALESCE(SUM(p.amount - p.refunded_amount),0) FROM payments p WHERE p.order_id = o.id AND p.status IN ('captured','partially_refunded','refunded'))";
  const mismatched = await db('orders as o').whereNot('o.payment_method', 'credit').andWhereRaw(`o.amount_paid != ${net}`)
    .select('o.id', 'o.order_number', 'o.amount_paid', db.raw(`${net} as payments_net`));
  res.json({ staleAttempts: stale, mismatchedOrders: mismatched });
}));

router.get('/invoices', requirePerm('orders.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('invoices as i').join('orders as o', 'o.id', 'i.order_id');
  if (req.query.from) q.where('i.invoice_date', '>=', String(req.query.from));
  if (req.query.to) q.andWhere('i.invoice_date', '<=', String(req.query.to));
  if (req.query.search) q.andWhere((w) => w.where('i.invoice_number', 'like', `%${req.query.search}%`).orWhere('i.buyer_name', 'like', `%${req.query.search}%`));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  res.json({ data: await q.select('i.*', 'o.order_number', 'o.status as order_status').orderBy('i.id', 'desc').limit(limit).offset(offset), page, limit, total });
}));

// ---------- Coupons ----------
const coupon = v.z.object({
  code: v.z.string().trim().toUpperCase().regex(/^[A-Z0-9_-]{3,40}$/, 'Letters, numbers, - and _ only'), description: v.opt(v.z.string().max(200)),
  discountType: v.z.enum(['percent', 'flat']), value: v.z.coerce.number().int().positive(), maxDiscount: v.paise.optional().nullable(), minOrderValue: v.paise.default(0),
  applicableTiers: v.z.array(v.tier).min(1), usageLimit: v.z.coerce.number().int().positive().optional().nullable(), perUserLimit: v.z.coerce.number().int().positive().default(1),
  validFrom: v.opt(v.z.string()).nullable(), validTo: v.opt(v.z.string()).nullable(), isActive: v.z.boolean().default(true),
}).refine((c) => c.discountType !== 'percent' || c.value <= 100, { message: 'Percent cannot exceed 100', path: ['value'] });
const couponRow = (c) => ({ code: c.code, description: c.description || null, discount_type: c.discountType, value: c.value, max_discount: c.maxDiscount ?? null, min_order_value: c.minOrderValue, applicable_tiers: JSON.stringify(c.applicableTiers), usage_limit: c.usageLimit ?? null, per_user_limit: c.perUserLimit, valid_from: c.validFrom ? c.validFrom.replace('T', ' ').slice(0, 19) : null, valid_to: c.validTo ? c.validTo.replace('T', ' ').slice(0, 19) : null, is_active: c.isActive });
router.get('/coupons', requirePerm('coupons.write'), ah(async (req, res) => res.json((await db('coupons').orderBy('id', 'desc')).map((c) => ({ ...c, applicable_tiers: parseJSON(c.applicable_tiers, []) })))));
router.post('/coupons', requirePerm('coupons.write'), validate({ body: coupon }), ah(async (req, res) => {
  const [id] = await db('coupons').insert(couponRow(req.body));
  await audit.log(req, 'coupon.create', 'coupon', id, req.body);
  res.status(201).json(await db('coupons').where({ id }).first());
}));
router.put('/coupons/:id', requirePerm('coupons.write'), validate({ body: coupon }), ah(async (req, res) => {
  await db('coupons').where({ id: req.params.id }).update({ ...couponRow(req.body), updated_at: db.fn.now() });
  await audit.log(req, 'coupon.update', 'coupon', req.params.id, req.body);
  res.json(await db('coupons').where({ id: req.params.id }).first());
}));
router.delete('/coupons/:id', requirePerm('coupons.write'), ah(async (req, res) => {
  if (await db('coupon_usage').where({ coupon_id: req.params.id }).first()) await db('coupons').where({ id: req.params.id }).update({ is_active: false });
  else await db('coupons').where({ id: req.params.id }).del();
  await audit.log(req, 'coupon.delete', 'coupon', req.params.id);
  res.json({ ok: true });
}));

// ---------- Delivery zones & staff ----------
const zone = v.z.object({ name: v.z.string().trim().min(2).max(120), pincodes: v.z.array(v.pincode).min(1), deliveryCharge: v.paise.default(0), freeDeliveryAbove: v.paise.optional().nullable(), minOrderValue: v.paise.default(0), isActive: v.z.boolean().default(true) });
const zoneRow = (z) => ({ name: z.name, pincodes: JSON.stringify([...new Set(z.pincodes)]), delivery_charge: z.deliveryCharge, free_delivery_above: z.freeDeliveryAbove ?? null, min_order_value: z.minOrderValue, is_active: z.isActive });
router.get('/zones', requirePerm('delivery.manage'), ah(async (req, res) => res.json((await db('delivery_zones as z').select('z.*', db.raw('(SELECT COUNT(*) FROM delivery_staff ds WHERE ds.zone_id = z.id) as staff_count'))).map((z) => ({ ...z, pincodes: parseJSON(z.pincodes, []) })))));
async function pincodeClash(pins, exceptId) {
  const others = await db('delivery_zones').whereNot('id', exceptId || 0);
  for (const o of others) { const hit = parseJSON(o.pincodes, []).find((p) => pins.includes(p)); if (hit) return `${hit} already belongs to ${o.name}`; }
  return null;
}
router.post('/zones', requirePerm('delivery.manage'), validate({ body: zone }), ah(async (req, res) => {
  const clash = await pincodeClash(req.body.pincodes); if (clash) throw bad(clash);
  const [id] = await db('delivery_zones').insert(zoneRow(req.body));
  await audit.log(req, 'zone.create', 'zone', id, req.body);
  res.status(201).json(await db('delivery_zones').where({ id }).first());
}));
router.put('/zones/:id', requirePerm('delivery.manage'), validate({ body: zone }), ah(async (req, res) => {
  const clash = await pincodeClash(req.body.pincodes, Number(req.params.id)); if (clash) throw bad(clash);
  await db('delivery_zones').where({ id: req.params.id }).update({ ...zoneRow(req.body), updated_at: db.fn.now() });
  // Re-map saved addresses to zones after pincode changes.
  for (const a of await db('user_addresses').select('id', 'pincode')) {
    const z = await orders.resolveZone(db, a.pincode);
    await db('user_addresses').where({ id: a.id }).update({ zone_id: z?.id || null });
  }
  await audit.log(req, 'zone.update', 'zone', req.params.id, req.body);
  res.json(await db('delivery_zones').where({ id: req.params.id }).first());
}));

router.get('/delivery/board', requirePerm('delivery.manage'), ah(async (req, res) => {
  const date = req.query.date || todayIST();
  const staff = await db('delivery_staff as ds').join('users as u', 'u.id', 'ds.user_id').leftJoin('delivery_zones as z', 'z.id', 'ds.zone_id').where('u.status', 'active')
    .select('ds.id', 'u.name', 'u.phone', 'ds.vehicle_number', 'ds.is_available', 'z.name as zone_name',
      db.raw("(SELECT COUNT(*) FROM delivery_assignments da WHERE da.staff_id = ds.id AND da.status IN ('assigned','picked_up','out_for_delivery')) as active"));
  for (const s of staff) s.report = await delivery.dailyReport(s.id, date);
  const active = await db('delivery_assignments as da').join('orders as o', 'o.id', 'da.order_id').join('users as u', 'u.id', 'o.user_id')
    .whereIn('da.status', ['assigned', 'picked_up', 'out_for_delivery']).orderBy(['da.staff_id', 'da.route_sequence'])
    .select('da.id', 'da.staff_id', 'da.status', 'da.route_sequence', 'o.id as order_id', 'o.order_number', 'o.grand_total', 'o.payment_method', 'o.delivery_slot', 'u.name as customer', 'o.address_snapshot');
  res.json({ date, staff, active: active.map((a) => ({ ...a, address: parseJSON(a.address_snapshot), address_snapshot: undefined })) });
}));
router.post('/delivery/assignments/:id/sequence', requirePerm('delivery.manage'), validate({ body: v.z.object({ sequence: v.z.coerce.number().int().min(1) }) }), ah(async (req, res) => {
  await db('delivery_assignments').where({ id: req.params.id }).update({ route_sequence: req.body.sequence });
  res.json({ ok: true });
}));
router.post('/delivery-staff/:id/reset-password', requirePerm('delivery.manage'), validate({ body: v.z.object({ password: v.password }) }), ah(async (req, res) => {
  const s = await db('delivery_staff').where({ id: req.params.id }).first();
  if (!s) throw notFound('Staff');
  await db('users').where({ id: s.user_id }).update({ password_hash: await authService.hashPassword(req.body.password), token_version: db.raw('token_version + 1') });
  res.json({ ok: true });
}));

// ---------- Jars ----------
router.get('/jars', requirePerm('jars.write'), ah(async (req, res) => {
  const q = db('jar_balances as j').join('users as u', 'u.id', 'j.user_id').join('roles as r', 'r.id', 'u.role_id');
  if (req.query.role) q.where('r.name', String(req.query.role));
  if (req.query.pendingOnly === 'true') q.andWhere('j.jars_pending', '>', 0);
  if (req.query.search) q.andWhere((w) => w.whereRaw('LOWER(u.name) LIKE ?', [`%${String(req.query.search).toLowerCase()}%`]).orWhere('u.phone', 'like', `%${req.query.search}%`));
  res.json({ summary: await jars.summary(), data: await q.select('j.*', 'u.name', 'u.phone', 'r.name as role').orderBy('j.jars_pending', 'desc').limit(500) });
}));
router.get('/jars/:userId/history', requirePerm('jars.write'), ah(async (req, res) => res.json(await db('jar_transactions as t').leftJoin('orders as o', 'o.id', 't.order_id').leftJoin('users as u', 'u.id', 't.recorded_by').where('t.user_id', req.params.userId).orderBy('t.id', 'desc').select('t.*', 'o.order_number', 'u.name as recorded_by_name'))));
router.post('/jars/:userId', requirePerm('jars.write'), validate({ body: v.z.object({ type: v.z.enum(['returned', 'deposit_collected', 'deposit_refunded', 'adjustment', 'damaged', 'lost']), jars: v.z.coerce.number().int().default(0), amount: v.paise.default(0), note: v.z.string().trim().min(2).max(300) }) }), ah(async (req, res) => {
  const b = await db.transaction(async (trx) => {
    const after = await jars.record(trx, { userId: Number(req.params.userId), type: req.body.type, jars: req.body.jars, amount: req.body.amount, note: req.body.note, by: req.user.id });
    if (req.body.type === 'returned') await trx('packaging_materials').where('name', 'like', '%Empty 20L%').increment('quantity', req.body.jars);
    await audit.log(req, `jar.${req.body.type}`, 'user', req.params.userId, req.body, trx);
    return after;
  });
  res.json(b);
}));

// ---------- Subscriptions ----------
router.get('/subscriptions', requirePerm('subscriptions.manage'), ah(async (req, res) => {
  const q = db('subscriptions as s').join('users as u', 'u.id', 's.user_id').join('products as p', 'p.id', 's.product_id');
  if (req.query.status) q.where('s.status', String(req.query.status));
  res.json(await q.select('s.*', 'u.name', 'u.phone', 'p.name as product_name',
    db.raw("(SELECT COUNT(*) FROM subscription_orders so WHERE so.subscription_id = s.id AND so.status='created') as orders_created"),
    db.raw("(SELECT COUNT(*) FROM subscription_orders so WHERE so.subscription_id = s.id AND so.status='failed') as orders_failed")).orderBy('s.next_run_date'));
}));
router.post('/subscriptions/:id/:action', requirePerm('subscriptions.manage'), ah(async (req, res) => {
  if (!['pause', 'resume', 'cancel'].includes(req.params.action)) throw notFound('Action');
  const s = await subs.setStatus(req.user, Number(req.params.id), req.params.action, req.body || {}, true);
  await audit.log(req, `subscription.${req.params.action}`, 'subscription', s.id);
  res.json(s);
}));
router.post('/subscriptions-run', requirePerm('subscriptions.manage'), ah(async (req, res) => {
  const r = await subs.generateDue(req.body?.date || todayIST());
  await audit.log(req, 'subscription.run', 'subscription', null, r);
  res.json(r);
}));

module.exports = router;
