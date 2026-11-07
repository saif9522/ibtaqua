/**
 * Recurring supply. A daily job generates orders `subscription_lead_days` ahead.
 * subscription_orders(subscription_id, scheduled_date) is UNIQUE, so re-running the job is safe.
 */
const db = require('../database/db');
const settings = require('./settings.service');
const orders = require('./order.service');
const notify = require('./notification.service');
const { bad, notFound, conflict } = require('../utils/errors');
const { todayIST, addDays, parseJSON } = require('../utils/helpers');
const { tierForRole } = require('../config/rbac');

const weekday = (iso) => new Date(`${iso}T00:00:00Z`).getUTCDay();

/** First delivery date strictly after `after` (or on/after `from` when inclusive). */
function nextDate(sub, from, inclusive = true) {
  let d = inclusive ? from : addDays(from, 1);
  const step = { daily: 1, alternate: 2, weekly: 7 }[sub.frequency];
  if (step) {
    // Keep cadence anchored to start_date
    const diff = Math.round((new Date(`${d}T00:00:00Z`) - new Date(`${sub.start_date}T00:00:00Z`)) / 86400e3);
    if (diff < 0) return sub.start_date;
    const r = diff % step;
    return r === 0 ? d : addDays(d, step - r);
  }
  if (sub.frequency === 'monthly') {
    const day = Number(sub.start_date.slice(8, 10));
    for (let i = 0; i < 62; i++, d = addDays(d, 1)) {
      const last = new Date(Date.UTC(+d.slice(0, 4), +d.slice(5, 7), 0)).getUTCDate();
      if (Number(d.slice(8, 10)) === Math.min(day, last)) return d;
    }
  }
  if (sub.frequency === 'custom') {
    const days = parseJSON(sub.custom_weekdays, []);
    if (!days.length) return null;
    for (let i = 0; i < 8; i++, d = addDays(d, 1)) if (days.includes(weekday(d))) return d;
  }
  return null;
}

async function create(user, data) {
  const addr = await db('user_addresses').where({ id: data.addressId, user_id: user.id }).first();
  if (!addr) throw notFound('Address');
  const p = await db('products').where({ id: data.productId, status: 'active' }).first();
  if (!p) throw notFound('Product');
  if (data.frequency === 'custom' && !data.customWeekdays?.length) throw bad('Choose at least one weekday');
  const start = data.startDate < todayIST() ? todayIST() : data.startDate;
  const sub = { start_date: start, frequency: data.frequency, custom_weekdays: JSON.stringify(data.customWeekdays || []) };
  const [id] = await db('subscriptions').insert({
    user_id: user.id, product_id: p.id, quantity: data.quantity, frequency: data.frequency, custom_weekdays: sub.custom_weekdays,
    address_id: addr.id, delivery_slot: data.deliverySlot || null, payment_method: data.paymentMethod || 'cod',
    start_date: start, end_date: data.endDate || null, next_run_date: nextDate(sub, start),
  });
  return db('subscriptions').where({ id }).first();
}

async function setStatus(user, id, action, { pausedUntil } = {}, isAdmin = false) {
  const q = db('subscriptions').where({ id });
  if (!isAdmin) q.andWhere({ user_id: user.id });
  const s = await q.first();
  if (!s) throw notFound('Subscription');
  if (s.status === 'cancelled') throw conflict('Subscription is cancelled');
  if (action === 'pause') await db('subscriptions').where({ id }).update({ status: 'paused', paused_until: pausedUntil || null, updated_at: db.fn.now() });
  if (action === 'resume') await db('subscriptions').where({ id }).update({ status: 'active', paused_until: null, next_run_date: nextDate(s, todayIST()), updated_at: db.fn.now() });
  if (action === 'cancel') await db('subscriptions').where({ id }).update({ status: 'cancelled', next_run_date: null, updated_at: db.fn.now() });
  return db('subscriptions').where({ id }).first();
}

async function generateDue(runDate = todayIST()) {
  const lead = await settings.get('subscription_lead_days', 1);
  const horizon = addDays(runDate, lead);
  // Auto-resume subscriptions whose pause window ended.
  const resumable = await db('subscriptions').where({ status: 'paused' }).whereNotNull('paused_until').andWhere('paused_until', '<=', runDate);
  for (const s of resumable) await db('subscriptions').where({ id: s.id }).update({ status: 'active', paused_until: null, next_run_date: nextDate(s, runDate) });

  const due = await db('subscriptions').where({ status: 'active' }).whereNotNull('next_run_date').andWhere('next_run_date', '<=', horizon);
  const results = { created: 0, failed: 0, skipped: 0 };
  for (const s of due) {
    // Missed runs (server down) are not back-filled: jump to the next date from today.
    const date = s.next_run_date < runDate ? nextDate(s, runDate) : s.next_run_date;
    if (!date || date > horizon) { await db('subscriptions').where({ id: s.id }).update({ next_run_date: date }); continue; }
    if (s.end_date && date > s.end_date) { await db('subscriptions').where({ id: s.id }).update({ status: 'cancelled', next_run_date: null }); continue; }
    const exists = await db('subscription_orders').where({ subscription_id: s.id, scheduled_date: date }).first();
    if (!exists) {
      const user = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', s.user_id).first('u.id', 'u.status', 'r.name as role');
      user.tier = tierForRole(user.role);
      try {
        if (user.status !== 'active') throw new Error('Account inactive');
        const o = await orders.placeOrder(user, { items: [{ productId: s.product_id, quantity: s.quantity }], addressId: s.address_id, paymentMethod: s.payment_method, deliveryDate: date, deliverySlot: s.delivery_slot, source: 'subscription', subscriptionId: s.id });
        await db('subscription_orders').insert({ subscription_id: s.id, order_id: o.id, scheduled_date: date });
        await db.transaction((trx) => notify.toUser(trx, s.user_id, { type: 'subscription_reminder', title: 'Your scheduled delivery is booked', body: `Order ${o.order_number} for ${date}.`, data: { orderId: o.id } }));
        results.created++;
      } catch (e) {
        await db('subscription_orders').insert({ subscription_id: s.id, scheduled_date: date, status: 'failed', note: e.message.slice(0, 300) });
        await db.transaction((trx) => notify.toUser(trx, s.user_id, { type: 'subscription_reminder', title: 'Scheduled delivery could not be booked', body: e.message }));
        results.failed++;
      }
    } else results.skipped++;
    await db('subscriptions').where({ id: s.id }).update({ next_run_date: nextDate(s, date, false) });
  }
  return results;
}

module.exports = { create, setStatus, generateDue, nextDate };
