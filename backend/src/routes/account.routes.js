/** Buyer endpoints: customers, retailers, wholesalers, distributors. */
const router = require('express').Router();
const db = require('../database/db');
const orders = require('../services/order.service');
const payments = require('../services/payment.service');
const subs = require('../services/subscription.service');
const invoices = require('../services/invoice.service');
const jars = require('../services/jar.service');
const { requireAuth, requireRole } = require('../middleware/auth');
const { validate } = require('../middleware/common');
const { ah, notFound, bad } = require('../utils/errors');
const { paginate, genNumber, parseJSON, todayIST } = require('../utils/helpers');
const { BUYER_ROLES, B2B_ROLES } = require('../config/rbac');
const v = require('../validators');

router.use(requireAuth(), requireRole(...BUYER_ROLES));

// ---------- Addresses ----------
const toAddr = (b) => ({
  label: b.label, contact_name: b.contactName, contact_phone: b.contactPhone, line1: b.line1, line2: b.line2 || null, landmark: b.landmark || null,
  city: b.city, state: b.state, pincode: b.pincode, lat: b.lat ?? null, lng: b.lng ?? null,
});
router.get('/addresses', ah(async (req, res) => res.json(await db('user_addresses').where({ user_id: req.user.id }).orderBy([{ column: 'is_default', order: 'desc' }, 'id']))));
router.post('/addresses', validate({ body: v.address }), ah(async (req, res) => {
  const zone = await orders.resolveZone(db, req.body.pincode);
  const id = await db.transaction(async (trx) => {
    const first = !(await trx('user_addresses').where({ user_id: req.user.id }).first());
    if (req.body.isDefault || first) await trx('user_addresses').where({ user_id: req.user.id }).update({ is_default: false });
    const [nid] = await trx('user_addresses').insert({ ...toAddr(req.body), user_id: req.user.id, zone_id: zone?.id || null, is_default: !!(req.body.isDefault || first) });
    return nid;
  });
  res.status(201).json({ ...(await db('user_addresses').where({ id }).first()), serviceable: !!zone });
}));
router.put('/addresses/:id', validate({ body: v.address }), ah(async (req, res) => {
  const a = await db('user_addresses').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!a) throw notFound('Address');
  const zone = await orders.resolveZone(db, req.body.pincode);
  await db.transaction(async (trx) => {
    if (req.body.isDefault) await trx('user_addresses').where({ user_id: req.user.id }).update({ is_default: false });
    await trx('user_addresses').where({ id: a.id }).update({ ...toAddr(req.body), zone_id: zone?.id || null, ...(req.body.isDefault && { is_default: true }), updated_at: trx.fn.now() });
  });
  res.json(await db('user_addresses').where({ id: a.id }).first());
}));
router.delete('/addresses/:id', ah(async (req, res) => {
  const n = await db('user_addresses').where({ id: req.params.id, user_id: req.user.id }).del().catch(() => { throw bad('This address is used by an active subscription'); });
  if (!n) throw notFound('Address');
  res.json({ ok: true });
}));

// ---------- Checkout ----------
router.post('/checkout/quote', validate({ body: v.checkout.quote }), ah(async (req, res) => {
  const q = await orders.quote(db, req.user, req.body);
  res.json({
    items: q.items.map((i) => ({ productId: i.productId, name: i.product.name, image: i.product.image, quantity: i.quantity, mrp: i.mrp, unitPrice: i.unitPrice, gstPercent: i.gstPercent, discount: i.discount, lineTotal: i.lineTotal })),
    summary: q.summary, coupon: q.coupon ? { code: q.coupon.code, description: q.coupon.description } : null,
    zone: q.zone ? { id: q.zone.id, name: q.zone.name } : null, paymentMethods: q.paymentMethods,
    deliverySlots: await require('../services/settings.service').get('delivery_slots', []),
  });
}));
router.post('/orders', validate({ body: v.checkout.place }), ah(async (req, res) => {
  const o = await orders.placeOrder(req.user, req.body);
  res.status(201).json({ id: o.id, orderNumber: o.order_number, status: o.status, grandTotal: o.grand_total, paymentMethod: o.payment_method, nextStep: ['razorpay', 'upi'].includes(o.payment_method) ? 'pay_online' : o.payment_method === 'bank_transfer' ? 'submit_reference' : 'done' });
}));

router.get('/orders', ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('orders').where({ user_id: req.user.id });
  if (req.query.status) q.andWhere('status', String(req.query.status));
  if (req.query.month) q.andWhereRaw("strftime('%Y-%m', created_at) = ?", [String(req.query.month)]);
  const total = (await q.clone().count({ n: '*' }).first()).n;
  const rows = await q.orderBy('id', 'desc').limit(limit).offset(offset)
    .select('id', 'order_number', 'status', 'payment_method', 'payment_status', 'grand_total', 'amount_paid', 'created_at', 'delivery_date', 'delivery_slot',
      db.raw('(SELECT COUNT(*) FROM order_items oi WHERE oi.order_id = orders.id) as item_count'),
      db.raw('(SELECT GROUP_CONCAT(product_name || \' × \' || quantity, \', \') FROM order_items oi WHERE oi.order_id = orders.id) as summary'));
  res.json({ data: rows, page, limit, total });
}));
router.get('/orders/:id', ah(async (req, res) => res.json(await orders.getOrderDetail(Number(req.params.id), req.user))));
// Lightweight poll endpoint for live tracking (status + latest timeline entry).
router.get('/orders/:id/status', ah(async (req, res) => {
  const o = await db('orders').where({ id: req.params.id, user_id: req.user.id }).first('status', 'payment_status', 'updated_at');
  if (!o) throw notFound('Order');
  res.json(o);
}));
router.post('/orders/:id/cancel', validate({ body: v.z.object({ reason: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => res.json(await orders.cancelByBuyer(req.user, Number(req.params.id), req.body.reason))));
router.post('/orders/:id/return', validate({ body: v.z.object({ reason: v.z.string().trim().min(5).max(500) }) }), ah(async (req, res) => res.json(await orders.requestReturn(req.user, Number(req.params.id), req.body.reason))));
router.get('/orders/:id/reorder', ah(async (req, res) => {
  const o = await db('orders').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!o) throw notFound('Order');
  res.json({ items: (await db('order_items').where({ order_id: o.id })).map((i) => ({ productId: i.product_id, quantity: i.quantity })) });
}));
router.get('/orders/:id/invoice.pdf', ah(async (req, res) => {
  const o = await db('orders').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!o) throw notFound('Order');
  const inv = await db('invoices').where({ order_id: o.id }).first();
  if (!inv) throw bad('The invoice is generated when your order is dispatched');
  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${inv.invoice_number.replace(/\//g, '-')}.pdf"`);
  await invoices.renderPdf(o.id, res);
}));

// ---------- Payments ----------
router.post('/payments/razorpay/order', validate({ body: v.z.object({ orderId: v.id }) }), ah(async (req, res) => res.json(await payments.createRazorpayOrder(req.user, req.body.orderId))));
router.post('/payments/razorpay/verify', validate({ body: v.z.object({ razorpay_order_id: v.z.string(), razorpay_payment_id: v.z.string(), razorpay_signature: v.z.string() }) }), ah(async (req, res) => res.json(await payments.verifyRazorpay(req.user, req.body))));
router.post('/payments/razorpay/failed', validate({ body: v.z.object({ razorpay_order_id: v.z.string(), reason: v.z.string().max(300).optional() }) }), ah(async (req, res) => { await payments.recordFailure(req.user, req.body); res.json({ ok: true }); }));
router.post('/payments/razorpay/dev-sign', validate({ body: v.z.object({ providerOrderId: v.z.string() }) }), ah(async (req, res) => {
  const p = await db('payments').where({ provider_order_id: req.body.providerOrderId, user_id: req.user.id }).first();
  if (!p) throw notFound('Payment');
  res.json(payments.devSignature(req.body.providerOrderId));
}));
router.post('/payments/offline', validate({ body: v.z.object({ orderId: v.id, referenceNo: v.z.string().trim().min(6).max(80), amount: v.paise.refine((x) => x > 0), method: v.z.enum(['bank_transfer', 'upi']) }) }), ah(async (req, res) => res.status(201).json({ id: await payments.submitOffline(req.user, req.body), message: 'Submitted. We will verify and update your order shortly.' })));
router.get('/payments', ah(async (req, res) => res.json(await db('payments as p').leftJoin('orders as o', 'o.id', 'p.order_id').where('p.user_id', req.user.id).orderBy('p.id', 'desc').limit(200)
  .select('p.id', 'p.method', 'p.amount', 'p.refunded_amount', 'p.status', 'p.reference_no', 'p.created_at', 'o.order_number'))));
router.get('/bank-details', ah(async (req, res) => res.json(await require('../services/settings.service').get('bank_details', {}))));

// ---------- Subscriptions ----------
router.get('/subscriptions', ah(async (req, res) => res.json(await db('subscriptions as s').join('products as p', 'p.id', 's.product_id').join('user_addresses as a', 'a.id', 's.address_id')
  .where('s.user_id', req.user.id).orderBy('s.id', 'desc').select('s.*', 'p.name as product_name', 'p.image as product_image', 'a.label as address_label', 'a.line1 as address_line1'))));
router.post('/subscriptions', validate({ body: v.z.object({
  productId: v.id, quantity: v.z.coerce.number().int().min(1).max(10000), frequency: v.z.enum(['daily', 'alternate', 'weekly', 'monthly', 'custom']),
  customWeekdays: v.z.array(v.z.number().int().min(0).max(6)).optional(), addressId: v.id, deliverySlot: v.opt(v.z.string().max(40)),
  paymentMethod: v.z.enum(['cod', 'credit']).default('cod'), startDate: v.isoDate, endDate: v.opt(v.isoDate),
}) }), ah(async (req, res) => {
  if (req.body.paymentMethod === 'credit' && !B2B_ROLES.includes(req.user.role)) throw bad('Credit is only for approved business accounts');
  // Validate price/MOQ/zone up front with a dry-run quote.
  await orders.quote(db, req.user, { items: [{ productId: req.body.productId, quantity: req.body.quantity }], addressId: req.body.addressId }).catch((e) => { if (!/in stock/.test(e.message)) throw e; });
  res.status(201).json(await subs.create(req.user, req.body));
}));
router.post('/subscriptions/:id/:action', validate({ body: v.z.object({ pausedUntil: v.opt(v.isoDate) }) }), ah(async (req, res) => {
  if (!['pause', 'resume', 'cancel'].includes(req.params.action)) throw notFound('Action');
  res.json(await subs.setStatus(req.user, Number(req.params.id), req.params.action, req.body));
}));
router.get('/subscriptions/:id/history', ah(async (req, res) => {
  const s = await db('subscriptions').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!s) throw notFound('Subscription');
  res.json(await db('subscription_orders as so').leftJoin('orders as o', 'o.id', 'so.order_id').where('so.subscription_id', s.id).orderBy('so.scheduled_date', 'desc')
    .select('so.*', 'o.order_number', 'o.status as order_status', 'o.grand_total', 'o.payment_status'));
}));

// ---------- Reviews, support, notifications, jars ----------
router.post('/reviews', validate({ body: v.z.object({ productId: v.id, rating: v.z.coerce.number().int().min(1).max(5), comment: v.opt(v.z.string().trim().max(1000)) }) }), ah(async (req, res) => {
  const bought = await db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id').where({ 'o.user_id': req.user.id, 'oi.product_id': req.body.productId, 'o.status': 'delivered' }).first('o.id');
  if (!bought) throw bad('You can review products after they are delivered to you');
  const existing = await db('reviews').where({ product_id: req.body.productId, user_id: req.user.id }).first();
  const row = { rating: req.body.rating, comment: req.body.comment || null, status: 'pending', order_id: bought.id, updated_at: db.fn.now() };
  if (existing) await db('reviews').where({ id: existing.id }).update(row);
  else await db('reviews').insert({ ...row, product_id: req.body.productId, user_id: req.user.id });
  res.status(201).json({ message: 'Thanks! Your review will appear after moderation.' });
}));

router.get('/tickets', ah(async (req, res) => res.json(await db('support_tickets').where({ user_id: req.user.id }).orderBy('id', 'desc'))));
router.post('/tickets', validate({ body: v.z.object({ subject: v.z.string().trim().min(4).max(200), message: v.z.string().trim().min(5).max(4000), category: v.z.enum(['general', 'complaint', 'delivery', 'payment', 'quality', 'sales', 'credit']).default('general'), orderId: v.id.optional() }) }), ah(async (req, res) => {
  if (req.body.orderId && !(await db('orders').where({ id: req.body.orderId, user_id: req.user.id }).first())) throw notFound('Order');
  const id = await db.transaction(async (trx) => {
    const [tid] = await trx('support_tickets').insert({ ticket_number: genNumber('TKT'), user_id: req.user.id, order_id: req.body.orderId || null, subject: req.body.subject, category: req.body.category, priority: req.body.category === 'complaint' ? 'high' : 'normal' });
    await trx('ticket_messages').insert({ ticket_id: tid, user_id: req.user.id, message: req.body.message });
    await require('../services/notification.service').toRole(trx, 'super_admin', { type: 'ticket', title: `New ${req.body.category} ticket`, body: req.body.subject, data: { ticketId: tid } });
    return tid;
  });
  res.status(201).json(await db('support_tickets').where({ id }).first());
}));
router.get('/tickets/:id', ah(async (req, res) => {
  const t = await db('support_tickets').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!t) throw notFound('Ticket');
  t.messages = await db('ticket_messages as m').join('users as u', 'u.id', 'm.user_id').where('m.ticket_id', t.id).orderBy('m.id').select('m.*', 'u.name');
  res.json(t);
}));
router.post('/tickets/:id/messages', validate({ body: v.z.object({ message: v.z.string().trim().min(1).max(4000) }) }), ah(async (req, res) => {
  const t = await db('support_tickets').where({ id: req.params.id, user_id: req.user.id }).first();
  if (!t) throw notFound('Ticket');
  await db('ticket_messages').insert({ ticket_id: t.id, user_id: req.user.id, message: req.body.message });
  if (t.status === 'resolved') await db('support_tickets').where({ id: t.id }).update({ status: 'open' });
  res.status(201).json({ ok: true });
}));

router.get('/notifications', ah(async (req, res) => {
  const rows = await db('notifications').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(50);
  const unread = (await db('notifications').where({ user_id: req.user.id, is_read: false }).count({ n: '*' }).first()).n;
  res.json({ data: rows.map((r) => ({ ...r, data: parseJSON(r.data), channels: undefined })), unread });
}));
router.post('/notifications/read', validate({ body: v.z.object({ ids: v.z.array(v.id).optional() }) }), ah(async (req, res) => {
  const q = db('notifications').where({ user_id: req.user.id });
  if (req.body.ids?.length) q.whereIn('id', req.body.ids);
  await q.update({ is_read: true });
  res.json({ ok: true });
}));
router.post('/device-tokens', validate({ body: v.z.object({ token: v.z.string().min(10).max(255), platform: v.z.enum(['android', 'ios', 'web']) }) }), ah(async (req, res) => {
  await db('device_tokens').insert({ user_id: req.user.id, token: req.body.token, platform: req.body.platform }).onConflict('token').merge({ user_id: req.user.id });
  res.json({ ok: true });
}));

router.get('/jars', ah(async (req, res) => {
  const balance = await jars.balance(db, req.user.id);
  const history = await db('jar_transactions').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(100);
  res.json({ balance, history, depositPerJar: await require('../services/settings.service').get('jar_deposit_amount', 0) });
}));

// ---------- B2B ----------
router.get('/business/summary', requireRole(...B2B_ROLES), ah(async (req, res) => {
  const biz = await db(`${req.user.role}s`).where({ user_id: req.user.id }).first();
  const outstanding = await orders.outstandingFor(db, req.user.id);
  const overdue = await db('orders').where({ user_id: req.user.id, payment_method: 'credit' }).whereNotIn('status', ['cancelled', 'returned'])
    .andWhereRaw('amount_paid < grand_total').andWhere('due_date', '<', todayIST()).sum({ v: db.raw('grand_total - amount_paid') }).first();
  const monthly = await db('orders').where({ user_id: req.user.id }).whereNotIn('status', ['cancelled', 'returned'])
    .select(db.raw("strftime('%Y-%m', datetime(created_at, '+330 minutes')) as month")).count({ orders: '*' }).sum({ total: 'grand_total', paid: 'amount_paid' })
    .groupBy('month').orderBy('month', 'desc').limit(12);
  const creditRequests = await db('credit_requests').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(5);
  const zones = req.user.role === 'distributor' ? await db('distributor_zones as dz').join('delivery_zones as z', 'z.id', 'dz.zone_id').where('dz.user_id', req.user.id).select('z.id', 'z.name') : [];
  const offers = await db('coupons').where('is_active', true).andWhere('applicable_tiers', 'like', `%"${req.user.tier}"%`).andWhere((q) => q.whereNull('valid_to').orWhere('valid_to', '>=', db.fn.now())).select('code', 'description', 'discount_type', 'value', 'min_order_value', 'valid_to');
  const negotiated = await db('product_prices as pp').join('products as p', 'p.id', 'pp.product_id').where({ 'pp.user_id': req.user.id, 'pp.is_active': true }).select('p.name', 'pp.price', 'pp.min_order_qty', 'pp.valid_to');
  res.json({
    business: biz,
    credit: { enabled: !!biz.credit_enabled, limit: biz.credit_limit, days: biz.credit_days, outstanding, available: Math.max(0, biz.credit_limit - outstanding), overdue: overdue?.v || 0 },
    monthly, creditRequests, zones, offers, negotiatedPrices: negotiated,
    salesContact: (await require('../services/settings.service').get('business_profile', {})).sales_phone || null,
  });
}));
router.post('/business/credit-request', requireRole(...B2B_ROLES), validate({ body: v.z.object({ requestedLimit: v.paise.refine((x) => x > 0), reason: v.opt(v.z.string().max(500)) }) }), ah(async (req, res) => {
  if (await db('credit_requests').where({ user_id: req.user.id, status: 'pending' }).first()) throw bad('You already have a pending credit request');
  const [id] = await db('credit_requests').insert({ user_id: req.user.id, requested_limit: req.body.requestedLimit, reason: req.body.reason || null });
  await db.transaction((trx) => require('../services/notification.service').toRole(trx, 'super_admin', { type: 'credit_request', title: 'Credit limit request', body: `${req.user.name} requested ₹${req.body.requestedLimit / 100}`, data: { id } }));
  res.status(201).json({ id });
}));
router.get('/business/statement', requireRole(...B2B_ROLES), ah(async (req, res) => {
  const from = req.query.from || `${todayIST().slice(0, 7)}-01`;
  const to = req.query.to || todayIST();
  const ordersIn = await db('orders').where({ user_id: req.user.id }).whereNotIn('status', ['cancelled']).whereRaw("date(datetime(created_at, '+330 minutes')) BETWEEN ? AND ?", [from, to])
    .select('created_at as date', 'order_number as ref', db.raw("'Order' as type"), 'grand_total as debit', db.raw('0 as credit'));
  const paysIn = await db('payments').where({ user_id: req.user.id, status: 'captured' }).whereRaw("date(datetime(created_at, '+330 minutes')) BETWEEN ? AND ?", [from, to])
    .select('created_at as date', db.raw("COALESCE(reference_no, provider_payment_id, method) as ref"), db.raw("'Payment' as type"), db.raw('0 as debit'), 'amount as credit');
  const rows = [...ordersIn, ...paysIn].sort((a, b) => String(a.date).localeCompare(String(b.date)));
  let bal = 0; rows.forEach((r) => { bal += r.debit - r.credit; r.balance = bal; });
  res.json({ from, to, rows, totals: { debit: rows.reduce((s, r) => s + r.debit, 0), credit: rows.reduce((s, r) => s + r.credit, 0) } });
}));

module.exports = router;
