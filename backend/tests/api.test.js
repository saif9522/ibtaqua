/**
 * End-to-end API tests against a fresh SQLite test database (data/test.sqlite).
 * Run: npm test
 */
process.env.NODE_ENV = 'test';
process.env.ENABLE_JOBS = 'false';
process.env.RAZORPAY_WEBHOOK_SECRET = 'whsec_test_123';
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const { test, before, after, describe } = require('node:test');
const assert = require('node:assert/strict');

for (const f of ['test.sqlite', 'test.sqlite-wal', 'test.sqlite-shm']) fs.rmSync(path.join(__dirname, '../data', f), { force: true });

const request = require('supertest');
const app = require('../src/app');
const db = require('../src/database/db');

const api = () => request(app);
const tokens = {};
const login = async (identifier, password) => {
  const r = await api().post('/api/auth/login').send({ identifier, password });
  assert.equal(r.status, 200, JSON.stringify(r.body));
  return r.body.accessToken;
};
const as = (who) => ({ Authorization: `Bearer ${tokens[who]}` });
const productId = async (sku) => (await db('products').where({ sku }).first()).id;
const stock = async (sku) => (await db('inventory').where({ product_id: await productId(sku) }).first());

before(async () => {
  await db.migrate.latest();
  await db.seed.run();
  await require('../src/database/demo').load();
  tokens.super = await login('admin@ibtaqua.test', 'Admin@123');
  tokens.admin = await login('ops@ibtaqua.test', 'Admin@123');
  tokens.retailer = await login('9000000201', 'Retail@123');
  tokens.wholesaler = await login('9000000301', 'Whole@123');
  tokens.distributor = await login('9000000401', 'Dist@123');
  tokens.driver = await login('9000000011', 'Delivery@123');
});
after(() => db.destroy());

describe('Auth', () => {
  test('OTP login creates a customer on first login and never trusts a wrong code', async () => {
    const req = await api().post('/api/auth/otp/request').send({ phone: '9876543210' });
    assert.equal(req.status, 200);
    assert.equal(req.body.isNewUser, true);
    assert.match(req.body.devOtp, /^\d{6}$/);
    const wrong = await api().post('/api/auth/otp/verify').send({ phone: '9876543210', code: req.body.devOtp === '000000' ? '111111' : '000000', name: 'Test User' });
    assert.equal(wrong.status, 400);
    const needName = await api().post('/api/auth/otp/verify').send({ phone: '9876543210', code: req.body.devOtp });
    assert.equal(needName.status, 400); // still unconsumed: name required for new account
    const ok = await api().post('/api/auth/otp/verify').send({ phone: '9876543210', code: req.body.devOtp, name: 'Test User' });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    assert.equal(ok.body.user.role, 'customer');
    tokens.customer = ok.body.accessToken;
    tokens.customerRefresh = ok.body.refreshToken;
  });

  test('refresh tokens rotate and a reused token is rejected', async () => {
    const r1 = await api().post('/api/auth/refresh').send({ refreshToken: tokens.customerRefresh });
    assert.equal(r1.status, 200);
    const reuse = await api().post('/api/auth/refresh').send({ refreshToken: tokens.customerRefresh });
    assert.equal(reuse.status, 401);
    // Reuse revoked the whole family, so the new one is dead too.
    const r2 = await api().post('/api/auth/refresh').send({ refreshToken: r1.body.refreshToken });
    assert.equal(r2.status, 401);
  });

  test('register with OTP sets a password; then mobile + password logs in; reset via OTP works', async () => {
    const dup = await api().post('/api/auth/otp/request').send({ phone: '9000000101', purpose: 'register' });
    assert.equal(dup.status, 409);
    const req = await api().post('/api/auth/otp/request').send({ phone: '9811112222', purpose: 'register' });
    assert.equal(req.status, 200);
    const reg = await api().post('/api/auth/otp/verify').send({ phone: '9811112222', code: req.body.devOtp, name: 'Neha', password: 'Water1234' });
    assert.equal(reg.status, 200, JSON.stringify(reg.body));
    const login = await api().post('/api/auth/login').send({ identifier: '9811112222', password: 'Water1234' });
    assert.equal(login.status, 200);
    const r2 = await api().post('/api/auth/otp/request').send({ phone: '9811112222', purpose: 'reset' });
    const reset = await api().post('/api/auth/password/reset').send({ phone: '9811112222', code: r2.body.devOtp, password: 'NewWater99' });
    assert.equal(reset.status, 200, JSON.stringify(reset.body));
    assert.equal((await api().post('/api/auth/login').send({ identifier: '9811112222', password: 'Water1234' })).status, 401);
    assert.equal((await api().post('/api/auth/login').send({ identifier: '9811112222', password: 'NewWater99' })).status, 200);
    // Old sessions were signed out by the reset.
    assert.equal((await api().get('/api/auth/me').set({ Authorization: `Bearer ${reg.body.accessToken}` })).status, 401);
  });

  test('wrong password gives a generic error', async () => {
    const r = await api().post('/api/auth/login').send({ identifier: '9000000201', password: 'nope' });
    assert.equal(r.status, 401);
    assert.match(r.body.error.message, /Incorrect/);
  });

  test('validation errors list fields', async () => {
    const r = await api().post('/api/auth/otp/request').send({ phone: '12345' });
    assert.equal(r.status, 422);
    assert.equal(r.body.error.fields[0].path, 'phone');
  });
});

describe('RBAC', () => {
  test('buyers and drivers cannot reach admin APIs', async () => {
    for (const who of ['customer', 'retailer', 'driver']) {
      const r = await api().get('/api/admin/dashboard').set(as(who));
      assert.equal(r.status, 403, who);
    }
    assert.equal((await api().get('/api/admin/dashboard')).status, 401);
  });
  test('admin (non-super) cannot change system settings', async () => {
    const r = await api().put('/api/admin/settings').set(as('admin')).send({ values: { return_window_days: 9 } });
    assert.equal(r.status, 403);
    const ok = await api().put('/api/admin/settings').set(as('super')).send({ values: { return_window_days: 3 } });
    assert.equal(ok.status, 200);
  });
  test('customers cannot use the delivery panel', async () => {
    assert.equal((await api().get('/api/delivery/run').set(as('customer'))).status, 403);
  });
});

describe('Pricing', () => {
  test('guests see only customer prices; partner prices never leak', async () => {
    const r = await api().get('/api/products?limit=50');
    assert.equal(r.status, 200);
    assert.equal(r.body.tier, 'customer');
    const body = JSON.stringify(r.body);
    assert.ok(!/retailer|wholesaler|distributor/.test(body.replace(/"tier":"customer"/g, '')), 'no other tier names in public payload');
    const oneL = r.body.data.find((p) => p.sku === 'IBT-1L-1');
    assert.equal(oneL.price.unitPrice, 2000);
    // Private-label product has no customer price → shown without price, can't be bought.
    const pl = r.body.data.find((p) => p.sku === 'IBT-PL-500-C24');
    assert.equal(pl.price, null);
  });
  test('each partner sees its own tier price', async () => {
    const get = async (who) => (await api().get('/api/products?limit=50').set(as(who))).body.data.find((p) => p.sku === 'IBT-1L-1').price;
    assert.equal((await get('retailer')).unitPrice, 1500);
    assert.equal((await get('wholesaler')).unitPrice, 1200);
    assert.equal((await get('distributor')).unitPrice, 1100);
  });
  test('negotiated distributor price beats the base price', async () => {
    const p = (await api().get('/api/products?limit=50').set(as('distributor'))).body.data.find((x) => x.sku === 'IBT-1L-C12').price;
    assert.equal(p.source, 'negotiated');
    assert.equal(p.unitPrice, 12500);
  });
});

describe('Checkout & orders', () => {
  let addressId; let orderId;
  test('address outside delivery zones is flagged', async () => {
    const r = await api().post('/api/account/addresses').set(as('customer')).send({ contactName: 'Test', contactPhone: '9876543210', line1: 'Somewhere far', city: 'Ranchi', state: 'Jharkhand', pincode: '834001' });
    assert.equal(r.status, 201);
    assert.equal(r.body.serviceable, false);
    const q = await api().post('/api/account/checkout/quote').set(as('customer')).send({ items: [{ productId: await productId('IBT-1L-1'), quantity: 2 }], addressId: r.body.id });
    assert.equal(q.status, 400);
    assert.match(q.body.error.message, /deliver/);
  });

  test('server computes totals and ignores client-sent prices', async () => {
    const a = await api().post('/api/account/addresses').set(as('customer')).send({ contactName: 'Test', contactPhone: '9876543210', line1: 'Bairiya Chowk', city: 'Medininagar', state: 'Jharkhand', pincode: '822101', isDefault: true });
    addressId = a.body.id;
    const pid = await productId('IBT-1L-C12');
    const before = await stock('IBT-1L-C12');
    const r = await api().post('/api/account/orders').set(as('customer')).send({ items: [{ productId: pid, quantity: 2, price: 1 }], addressId, paymentMethod: 'cod', unitPrice: 1, grandTotal: 1 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    orderId = r.body.id;
    const o = await db('orders').where({ id: orderId }).first();
    // 2 × ₹220 = ₹440 (> ₹300 free-delivery threshold, so delivery is free)
    assert.equal(o.grand_total, 44000);
    assert.equal(o.taxable_total + o.gst_total, 44000);
    assert.equal(o.status, 'confirmed'); // COD auto-confirms
    const afterS = await stock('IBT-1L-C12');
    assert.equal(afterS.quantity_available, before.quantity_available - 2);
    const alloc = await db('order_item_batches as ob').join('order_items as oi', 'oi.id', 'ob.order_item_id').where('oi.order_id', orderId).sum({ q: 'ob.quantity' }).first();
    assert.equal(alloc.q, 2, 'FIFO batch allocation on confirm');
  });

  test('coupon is applied server-side and limited per user', async () => {
    const items = [{ productId: await productId('IBT-20L-JAR'), quantity: 4 }];
    const q = await api().post('/api/account/checkout/quote').set(as('customer')).send({ items, addressId, couponCode: 'welcome10' });
    assert.equal(q.status, 200, JSON.stringify(q.body));
    assert.ok(q.body.summary.discountTotal > 0 && q.body.summary.discountTotal <= 5000);
    assert.ok(q.body.summary.jarDeposit > 0, 'new customer pays jar deposit');
    const o = await api().post('/api/account/orders').set(as('customer')).send({ items, addressId, couponCode: 'WELCOME10', paymentMethod: 'cod' });
    assert.equal(o.status, 201);
    const again = await api().post('/api/account/checkout/quote').set(as('customer')).send({ items, addressId, couponCode: 'WELCOME10' });
    assert.equal(again.status, 400);
  });

  test('buyer cancel releases stock back', async () => {
    const before = await stock('IBT-1L-C12');
    const r = await api().post(`/api/account/orders/${orderId}/cancel`).set(as('customer')).send({ reason: 'test' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const afterS = await stock('IBT-1L-C12');
    assert.equal(afterS.quantity_available, before.quantity_available + 2);
  });

  test('users cannot read each other’s orders', async () => {
    const other = await db('orders').where({ user_id: (await db('users').where({ phone: '9000000101' }).first()).id }).first();
    assert.equal((await api().get(`/api/account/orders/${other.id}`).set(as('customer'))).status, 403);
  });

  test('retailer minimum order quantity is enforced', async () => {
    const ad = (await api().get('/api/account/addresses').set(as('retailer'))).body[0].id;
    const r = await api().post('/api/account/checkout/quote').set(as('retailer')).send({ items: [{ productId: await productId('IBT-1L-1'), quantity: 3 }], addressId: ad });
    assert.equal(r.status, 422);
    assert.match(r.body.error.message, /minimum order is 12/);
  });

  test('credit purchase respects the credit limit', async () => {
    const ad = (await api().get('/api/account/addresses').set(as('retailer'))).body[0].id;
    const big = await api().post('/api/account/checkout/quote').set(as('retailer')).send({ items: [{ productId: await productId('IBT-1L-C12'), quantity: 200 }], addressId: ad, paymentMethod: 'credit' });
    assert.equal(big.status, 400);
    assert.match(big.body.error.message, /credit/i);
    const sum = await api().get('/api/account/business/summary').set(as('retailer'));
    assert.equal(sum.status, 200);
    assert.ok(sum.body.credit.limit > 0);
  });
});

describe('Payments', () => {
  let order; let rp;
  before(async () => {
    const addressId = (await api().get('/api/account/addresses').set(as('customer'))).body.find((a) => a.pincode === '822101').id;
    const r = await api().post('/api/account/orders').set(as('customer')).send({ items: [{ productId: await productId('IBT-500-C24'), quantity: 1 }], addressId, paymentMethod: 'razorpay' });
    order = r.body;
    assert.equal(order.status, 'pending');
  });
  test('forged signature is rejected; order stays unpaid', async () => {
    rp = (await api().post('/api/account/payments/razorpay/order').set(as('customer')).send({ orderId: order.id })).body;
    assert.ok(rp.providerOrderId);
    const r = await api().post('/api/account/payments/razorpay/verify').set(as('customer')).send({ razorpay_order_id: rp.providerOrderId, razorpay_payment_id: 'pay_fake', razorpay_signature: 'deadbeef' });
    assert.equal(r.status, 400);
    assert.equal((await db('orders').where({ id: order.id }).first()).payment_status, 'unpaid');
  });
  test('valid signature captures payment, confirms order, and replays are idempotent', async () => {
    const sig = (await api().post('/api/account/payments/razorpay/dev-sign').set(as('customer')).send({ providerOrderId: rp.providerOrderId })).body;
    const r = await api().post('/api/account/payments/razorpay/verify').set(as('customer')).send(sig);
    assert.equal(r.status, 200, JSON.stringify(r.body));
    const o = await db('orders').where({ id: order.id }).first();
    assert.equal(o.payment_status, 'paid');
    assert.equal(o.status, 'confirmed');
    const replay = await api().post('/api/account/payments/razorpay/verify').set(as('customer')).send(sig);
    assert.equal(replay.body.status, 'already_captured');
    assert.equal((await db('orders').where({ id: order.id }).first()).amount_paid, o.amount_paid);
  });
  test('webhook requires a valid signature and ignores duplicate events', async () => {
    const body = JSON.stringify({ id: 'evt_1', event: 'payment.captured', payload: { payment: { entity: { id: 'pay_x', order_id: 'order_nope', amount: 100 } } } });
    const bad = await api().post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', 'bad').send(body);
    assert.equal(bad.status, 400);
    const sig = crypto.createHmac('sha256', 'whsec_test_123').update(body).digest('hex');
    const ok = await api().post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', sig).send(body);
    assert.equal(ok.status, 200);
    const dup = await api().post('/api/webhooks/razorpay').set('Content-Type', 'application/json').set('x-razorpay-signature', sig).send(body);
    assert.equal(dup.body.duplicate, true);
  });
  test('admin refund updates order payment status', async () => {
    const p = await db('payments').where({ order_id: order.id, status: 'captured' }).first();
    const r = await api().post(`/api/admin/payments/${p.id}/refund`).set(as('admin')).send({ amount: p.amount, reason: 'Test refund' });
    assert.equal(r.status, 200, JSON.stringify(r.body));
    assert.equal((await db('orders').where({ id: order.id }).first()).payment_status, 'refunded');
  });
});

describe('Delivery', () => {
  let orderId; let assignmentId;
  before(async () => {
    const addressId = (await api().get('/api/account/addresses').set(as('customer'))).body.find((a) => a.pincode === '822101').id;
    const r = await api().post('/api/account/orders').set(as('customer')).send({ items: [{ productId: await productId('IBT-20L-JAR'), quantity: 2 }], addressId, paymentMethod: 'cod' });
    orderId = r.body.id;
    const staff = await db('delivery_staff as ds').join('users as u', 'u.id', 'ds.user_id').where('u.phone', '9000000011').first('ds.id');
    const a = await api().post(`/api/admin/orders/${orderId}/assign`).set(as('admin')).send({ staffId: staff.id });
    assert.equal(a.status, 200, JSON.stringify(a.body));
    assignmentId = (await db('delivery_assignments').where({ order_id: orderId }).first()).id;
  });
  test('driver sees the stop but not the delivery OTP', async () => {
    const run = await api().get('/api/delivery/run').set(as('driver'));
    const stop = run.body.stops.find((s) => s.order_id === orderId);
    assert.ok(stop);
    assert.equal(stop.delivery_otp, undefined);
    assert.ok(stop.mapsUrl.startsWith('https://www.google.com/maps'));
  });
  test('pickup → start → OTP + cash required → delivered, jars issued', async () => {
    assert.equal((await api().post(`/api/delivery/assignments/${assignmentId}/pickup`).set(as('driver'))).status, 200);
    assert.equal((await api().post(`/api/delivery/assignments/${assignmentId}/start`).set(as('driver'))).status, 200);
    const o = await db('orders').where({ id: orderId }).first();
    assert.equal(o.status, 'out_for_delivery');
    const wrongOtp = await api().post(`/api/delivery/assignments/${assignmentId}/complete`).set(as('driver')).send({ otp: o.delivery_otp === '0000' ? '1111' : '0000', cashCollected: o.grand_total });
    assert.equal(wrongOtp.status, 400);
    const noCash = await api().post(`/api/delivery/assignments/${assignmentId}/complete`).set(as('driver')).send({ otp: o.delivery_otp, cashCollected: 0 });
    assert.equal(noCash.status, 400);
    const ok = await api().post(`/api/delivery/assignments/${assignmentId}/complete`).set(as('driver')).send({ otp: o.delivery_otp, cashCollected: o.grand_total, emptyJarsCollected: 0 });
    assert.equal(ok.status, 200, JSON.stringify(ok.body));
    const done = await db('orders').where({ id: orderId }).first();
    assert.equal(done.status, 'delivered');
    assert.equal(done.payment_status, 'paid');
    assert.ok(await db('invoices').where({ order_id: orderId }).first(), 'invoice issued');
    const jars = await db('jar_balances').where({ user_id: done.user_id }).first();
    assert.ok(jars.jars_pending >= 2);
  });
  test('invoice PDF downloads for the buyer', async () => {
    const r = await api().get(`/api/account/orders/${orderId}/invoice.pdf`).set(as('customer')).buffer(true).parse((res, cb) => { const c = []; res.on('data', (d) => c.push(d)); res.on('end', () => cb(null, Buffer.concat(c))); });
    assert.equal(r.status, 200);
    assert.equal(r.body.subarray(0, 4).toString(), '%PDF');
  });
});

describe('Partners', () => {
  test('pending retailer cannot order until approved', async () => {
    const reg = await api().post('/api/auth/register/retailer').send({ businessName: 'New Shop', contactPerson: 'Owner', phone: '9123456780', password: 'Shop12345', gstin: '20ABCDE1234F1Z5', address: 'Market Road 1', city: 'Medininagar', state: 'Jharkhand', pincode: '822101' });
    assert.equal(reg.status, 201, JSON.stringify(reg.body));
    assert.equal(reg.body.user.status, 'pending');
    const t = reg.body.accessToken;
    assert.equal((await api().get('/api/account/orders').set({ Authorization: `Bearer ${t}` })).status, 403);
    assert.equal((await api().get('/api/auth/me').set({ Authorization: `Bearer ${t}` })).status, 200);
    const approve = await api().post(`/api/admin/users/${reg.body.user.id}/approval`).set(as('admin')).send({ decision: 'approved', creditLimit: 1000000, creditDays: 15 });
    assert.equal(approve.status, 200);
    assert.equal((await api().get('/api/account/orders').set({ Authorization: `Bearer ${t}` })).status, 200);
  });
  test('statement balances debits and credits', async () => {
    const r = await api().get('/api/account/business/statement?from=2020-01-01').set(as('wholesaler'));
    assert.equal(r.status, 200);
    assert.equal(r.body.rows.at(-1).balance, r.body.totals.debit - r.body.totals.credit);
  });
});

describe('Inventory, subscriptions, reports', () => {
  test('new production batch adds stock and a movement', async () => {
    const pid = await productId('IBT-2L-C9');
    const before = await stock('IBT-2L-C9');
    const r = await api().post('/api/admin/batches').set(as('admin')).send({ productId: pid, batchNumber: 'TEST-001', manufacturingDate: '2026-11-01', expiryDate: '2027-05-01', quantity: 100 });
    assert.equal(r.status, 201, JSON.stringify(r.body));
    assert.equal((await stock('IBT-2L-C9')).quantity_available, before.quantity_available + 100);
    const bad = await api().post('/api/admin/inventory/adjust').set(as('admin')).send({ productId: pid, batchId: r.body.id, quantity: -1000, reason: 'test' });
    assert.equal(bad.status, 400);
  });
  test('subscription generation is idempotent', async () => {
    const r1 = await api().post('/api/admin/subscriptions-run').set(as('admin')).send({});
    assert.equal(r1.status, 200);
    const count = (await db('subscription_orders').count({ n: '*' }).first()).n;
    await api().post('/api/admin/subscriptions-run').set(as('admin')).send({});
    assert.equal((await db('subscription_orders').count({ n: '*' }).first()).n, count);
  });
  test('dashboard and reports work in JSON, Excel and PDF', async () => {
    const d = await api().get('/api/admin/dashboard').set(as('admin'));
    assert.equal(d.status, 200);
    assert.ok(d.body.stats.totalOrders > 0);
    for (const name of ['sales', 'buyers', 'products', 'gst', 'payments', 'outstanding', 'delivery', 'inventory', 'jars', 'profit']) {
      const r = await api().get(`/api/admin/reports/${name}`).set(as('admin'));
      assert.equal(r.status, 200, name);
      assert.ok(Array.isArray(r.body.rows), name);
    }
    const x = await api().get('/api/admin/reports/sales?format=xlsx').set(as('admin'));
    assert.equal(x.status, 200);
    assert.match(x.headers['content-type'], /spreadsheet/);
    const p = await api().get('/api/admin/reports/gst?format=pdf').set(as('admin'));
    assert.equal(p.status, 200);
  });
  test('audit log records admin actions', async () => {
    const r = await api().get('/api/admin/audit-logs').set(as('super'));
    assert.ok(r.body.data.some((a) => a.action === 'batch.create'));
  });
});
