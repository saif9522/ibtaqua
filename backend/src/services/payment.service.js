/**
 * Payments. An order is only ever marked paid from server-side evidence:
 *   - Razorpay: HMAC signature check + (when keys are set) a fetch of the payment from Razorpay,
 *     or a signed webhook.
 *   - Bank transfer / UPI reference: admin verification.
 *   - Cash: recorded by delivery staff or admin.
 * provider_payment_id and provider_event_id are UNIQUE, so replays cannot double-credit.
 */
const crypto = require('crypto');
const Razorpay = require('razorpay');
const db = require('../database/db');
const env = require('../config/env');
const orders = require('./order.service');
const notify = require('./notification.service');
const { bad, notFound, conflict, forbidden, AppError } = require('../utils/errors');

const DEV_SECRET = 'dev_razorpay_secret_not_for_production';
const keySecret = () => env.RAZORPAY_KEY_SECRET || (env.isProd ? null : DEV_SECRET);
const isLive = () => !!(env.RAZORPAY_KEY_ID && env.RAZORPAY_KEY_SECRET);
const client = () => (isLive() ? new Razorpay({ key_id: env.RAZORPAY_KEY_ID, key_secret: env.RAZORPAY_KEY_SECRET }) : null);

const hmac = (secret, data) => crypto.createHmac('sha256', secret).update(data).digest('hex');
const safeEqual = (a, b) => {
  const x = Buffer.from(String(a)); const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
};

const txn = (trx, row) => trx('payment_transactions').insert({ ...row, payload: row.payload ? JSON.stringify(row.payload) : null });

/** Credit a captured payment to its order and move the order forward. */
async function applyToOrder(trx, payment, actor = { system: true }) {
  if (!payment.order_id) return;
  const o = await trx('orders').where({ id: payment.order_id }).first();
  const paid = Math.min(o.grand_total, o.amount_paid + payment.amount);
  await trx('orders').where({ id: o.id }).update({ amount_paid: paid, payment_status: paid >= o.grand_total ? 'paid' : 'partially_paid', updated_at: trx.fn.now() });
  await notify.toUser(trx, o.user_id, { type: 'payment_received', title: `Payment received · ${o.order_number}`, body: `₹${payment.amount / 100} received via ${payment.method.replace('_', ' ')}.`, data: { orderId: o.id } });
  if (o.status === 'pending') await orders.transition(trx, o.id, 'confirmed', actor, 'Payment received');
}

async function createRazorpayOrder(user, orderId) {
  const secret = keySecret();
  if (!secret) throw new AppError(503, 'Online payments are not configured', 'PAYMENTS_DISABLED');
  return db.transaction(async (trx) => {
    const o = await trx('orders').where({ id: orderId, user_id: user.id }).first();
    if (!o) throw notFound('Order');
    if (['cancelled', 'returned'].includes(o.status)) throw bad('This order is cancelled');
    const due = o.grand_total - o.amount_paid;
    if (due <= 0) throw conflict('This order is already paid');
    // Reuse an open attempt for the same amount instead of creating duplicates.
    const open = await trx('payments').where({ order_id: o.id, method: 'razorpay', status: 'created', amount: due }).first();
    if (open) return { keyId: env.RAZORPAY_KEY_ID || 'rzp_test_dev', providerOrderId: open.provider_order_id, amount: due, currency: 'INR', orderNumber: o.order_number, mock: !isLive() };
    let providerOrderId;
    if (isLive()) {
      const rp = await client().orders.create({ amount: due, currency: 'INR', receipt: o.order_number, notes: { order_id: String(o.id) } });
      providerOrderId = rp.id;
    } else providerOrderId = `order_dev_${crypto.randomBytes(7).toString('hex')}`;
    const [pid] = await trx('payments').insert({ order_id: o.id, user_id: user.id, method: 'razorpay', amount: due, status: 'created', provider_order_id: providerOrderId });
    await txn(trx, { payment_id: pid, type: 'create', amount: due });
    if (o.payment_method !== 'razorpay' && o.payment_method !== 'upi') await trx('orders').where({ id: o.id }).update({ payment_method: 'razorpay' });
    return { keyId: env.RAZORPAY_KEY_ID || 'rzp_test_dev', providerOrderId, amount: due, currency: 'INR', orderNumber: o.order_number, mock: !isLive() };
  });
}

async function verifyRazorpay(user, { razorpay_order_id: rOrder, razorpay_payment_id: rPay, razorpay_signature: sig }) {
  const secret = keySecret();
  if (!secret) throw new AppError(503, 'Online payments are not configured', 'PAYMENTS_DISABLED');
  if (!safeEqual(hmac(secret, `${rOrder}|${rPay}`), sig)) throw bad('Payment verification failed');
  return db.transaction(async (trx) => {
    const p = await trx('payments').where({ provider_order_id: rOrder }).first();
    if (!p) throw notFound('Payment');
    if (p.user_id !== user.id) throw forbidden();
    if (p.status === 'captured') return { status: 'already_captured', orderId: p.order_id }; // idempotent
    if (isLive()) {
      const remote = await client().payments.fetch(rPay);
      if (remote.order_id !== rOrder || Number(remote.amount) !== p.amount || !['captured', 'authorized'].includes(remote.status)) {
        await txn(trx, { payment_id: p.id, type: 'fail', payload: { reason: 'mismatch', status: remote.status } });
        throw bad('Payment could not be confirmed with the bank');
      }
    }
    await trx('payments').where({ id: p.id }).update({ status: 'captured', provider_payment_id: rPay, updated_at: trx.fn.now() });
    await txn(trx, { payment_id: p.id, type: 'verify', amount: p.amount, payload: { rPay } });
    await applyToOrder(trx, { ...p, status: 'captured' }, user);
    return { status: 'captured', orderId: p.order_id };
  });
}

/** Dev-only helper so the checkout can be exercised without Razorpay keys. */
function devSignature(providerOrderId) {
  if (env.isProd || isLive()) throw forbidden('Not available');
  const payId = `pay_dev_${crypto.randomBytes(7).toString('hex')}`;
  return { razorpay_order_id: providerOrderId, razorpay_payment_id: payId, razorpay_signature: hmac(DEV_SECRET, `${providerOrderId}|${payId}`) };
}

async function recordFailure(user, { razorpay_order_id: rOrder, reason }) {
  const p = await db('payments').where({ provider_order_id: rOrder, user_id: user.id }).first();
  if (!p || p.status !== 'created') return;
  await db('payments').where({ id: p.id }).update({ status: 'failed', failure_reason: String(reason || 'Payment failed').slice(0, 300) });
  await txn(db, { payment_id: p.id, type: 'fail', payload: { reason } });
}

async function handleWebhook(rawBody, signature) {
  if (!env.RAZORPAY_WEBHOOK_SECRET) throw new AppError(503, 'Webhook not configured', 'WEBHOOK_DISABLED');
  if (!signature || !safeEqual(hmac(env.RAZORPAY_WEBHOOK_SECRET, rawBody), signature)) throw new AppError(400, 'Invalid signature', 'BAD_SIGNATURE');
  const evt = JSON.parse(rawBody.toString('utf8'));
  const eventId = evt.id || `${evt.event}:${evt.payload?.payment?.entity?.id || evt.payload?.refund?.entity?.id}`;
  return db.transaction(async (trx) => {
    if (await trx('payment_transactions').where({ provider_event_id: eventId }).first()) return { duplicate: true };
    const pay = evt.payload?.payment?.entity;
    const p = pay?.order_id ? await trx('payments').where({ provider_order_id: pay.order_id }).first() : null;
    await txn(trx, { payment_id: p?.id || null, type: 'webhook', provider_event_id: eventId, amount: pay?.amount, payload: { event: evt.event } });
    if (!p) return { ignored: true };
    if (evt.event === 'payment.captured' && p.status !== 'captured') {
      if (Number(pay.amount) !== p.amount) return { mismatch: true };
      await trx('payments').where({ id: p.id }).update({ status: 'captured', provider_payment_id: pay.id, updated_at: trx.fn.now() });
      await applyToOrder(trx, p);
    } else if (evt.event === 'payment.failed' && p.status === 'created') {
      await trx('payments').where({ id: p.id }).update({ status: 'failed', failure_reason: pay.error_description || 'Failed' });
    } else if (evt.event === 'refund.processed') {
      const r = evt.payload.refund.entity;
      await trx('payment_transactions').where({ payment_id: p.id, type: 'refund' }).whereNull('provider_event_id').update({ payload: JSON.stringify({ refundId: r.id, processed: true }) });
    }
    return { ok: true };
  });
}

/** Buyer submits a bank/UPI transfer reference; admin verifies later. */
async function submitOffline(user, { orderId, referenceNo, amount, method }) {
  return db.transaction(async (trx) => {
    const o = await trx('orders').where({ id: orderId, user_id: user.id }).first();
    if (!o) throw notFound('Order');
    const due = o.grand_total - o.amount_paid;
    if (amount > due) throw bad(`Amount exceeds the due amount of ₹${due / 100}`);
    const dup = await trx('payments').where({ reference_no: referenceNo, method }).whereIn('status', ['pending_verification', 'captured']).first();
    if (dup) throw conflict('This reference number has already been submitted');
    const [id] = await trx('payments').insert({ order_id: o.id, user_id: user.id, method, amount, status: 'pending_verification', reference_no: referenceNo });
    await txn(trx, { payment_id: id, type: 'manual', amount, payload: { referenceNo } });
    await trx('orders').where({ id: o.id }).update({ payment_status: o.amount_paid ? 'partially_paid' : 'pending_verification' });
    await notify.toRole(trx, 'super_admin', { type: 'payment_verification', title: 'Payment to verify', body: `${o.order_number}: ₹${amount / 100} ref ${referenceNo}`, data: { paymentId: id } });
    return id;
  });
}

async function verifyOffline(admin, paymentId, approve, note) {
  return db.transaction(async (trx) => {
    const p = await trx('payments').where({ id: paymentId }).first();
    if (!p) throw notFound('Payment');
    if (p.status !== 'pending_verification') throw conflict('Payment is not awaiting verification');
    await trx('payments').where({ id: p.id }).update({ status: approve ? 'captured' : 'rejected', verified_by: admin.id, verified_at: trx.fn.now(), failure_reason: approve ? null : note });
    await txn(trx, { payment_id: p.id, type: 'manual', amount: p.amount, payload: { approve, note, by: admin.id } });
    if (approve) {
      if (p.order_id) await applyToOrder(trx, p, admin);
      else await allocateCredit(trx, p.user_id, p.amount);
    } else if (p.order_id) {
      const o = await trx('orders').where({ id: p.order_id }).first();
      await trx('orders').where({ id: o.id }).update({ payment_status: o.amount_paid ? 'partially_paid' : 'unpaid' });
    }
  });
}

/** Cash collected at the door (delivery staff) or at the counter (admin). */
async function recordCash(trx, { orderId, amount, by }) {
  const o = await trx('orders').where({ id: orderId }).first();
  const due = o.grand_total - o.amount_paid;
  if (amount <= 0) return null;
  if (amount > due) throw bad(`Collected amount exceeds due ₹${due / 100}`);
  const [id] = await trx('payments').insert({ order_id: o.id, user_id: o.user_id, method: 'cash', amount, status: 'captured', verified_by: by, verified_at: trx.fn.now() });
  await txn(trx, { payment_id: id, type: 'capture', amount, payload: { by } });
  await applyToOrder(trx, { id, order_id: o.id, amount, method: 'cash' }, { id: by });
  return id;
}

/** B2B credit settlement: one payment spread oldest-first across unpaid credit orders. */
async function allocateCredit(trx, userId, amount) {
  let left = amount;
  const open = await trx('orders').where({ user_id: userId, payment_method: 'credit' }).whereNotIn('status', ['cancelled', 'returned'])
    .andWhereRaw('amount_paid < grand_total').orderBy('created_at');
  for (const o of open) {
    if (!left) break;
    const take = Math.min(left, o.grand_total - o.amount_paid);
    const paid = o.amount_paid + take;
    await trx('orders').where({ id: o.id }).update({ amount_paid: paid, payment_status: paid >= o.grand_total ? 'paid' : 'partially_paid' });
    left -= take;
  }
  return amount - left;
}

async function recordCreditSettlement(admin, { userId, amount, method, referenceNo }) {
  return db.transaction(async (trx) => {
    const due = await orders.outstandingFor(trx, userId);
    if (amount > due) throw bad(`Amount exceeds outstanding ₹${due / 100}`);
    const [id] = await trx('payments').insert({ user_id: userId, method: 'credit_settlement', amount, status: 'captured', reference_no: referenceNo, verified_by: admin.id, verified_at: trx.fn.now() });
    await txn(trx, { payment_id: id, type: 'manual', amount, payload: { method, referenceNo } });
    await allocateCredit(trx, userId, amount);
    await notify.toUser(trx, userId, { type: 'payment_received', title: 'Payment received', body: `₹${amount / 100} applied to your outstanding balance.` });
    return id;
  });
}

async function refund(admin, paymentId, amount, reason) {
  const p = await db('payments').where({ id: paymentId }).first();
  if (!p) throw notFound('Payment');
  if (!['captured', 'partially_refunded'].includes(p.status)) throw conflict('Only captured payments can be refunded');
  if (amount > p.amount - p.refunded_amount) throw bad('Refund exceeds refundable amount');
  let providerRef = null;
  if (p.method === 'razorpay' && isLive()) {
    const r = await client().payments.refund(p.provider_payment_id, { amount, notes: { reason } });
    providerRef = r.id;
  }
  return db.transaction(async (trx) => {
    const refunded = p.refunded_amount + amount;
    await trx('payments').where({ id: p.id }).update({ refunded_amount: refunded, status: refunded >= p.amount ? 'refunded' : 'partially_refunded' });
    await txn(trx, { payment_id: p.id, type: 'refund', amount, payload: { reason, providerRef, by: admin.id, mode: providerRef ? 'razorpay' : 'manual' } });
    if (p.order_id) {
      const o = await trx('orders').where({ id: p.order_id }).first();
      const paid = Math.max(0, o.amount_paid - amount);
      await trx('orders').where({ id: o.id }).update({ amount_paid: paid, payment_status: paid === 0 ? 'refunded' : 'partially_refunded' });
      await notify.toUser(trx, o.user_id, { type: 'refund', title: `Refund initiated · ${o.order_number}`, body: `₹${amount / 100} will reach your account in 5–7 working days.` });
    }
  });
}

module.exports = { createRazorpayOrder, verifyRazorpay, devSignature, recordFailure, handleWebhook, submitOffline, verifyOffline, recordCash, recordCreditSettlement, allocateCredit, refund, isLive };
