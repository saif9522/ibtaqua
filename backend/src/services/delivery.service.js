const db = require('../database/db');
const orders = require('./order.service');
const payments = require('./payment.service');
const jars = require('./jar.service');
const { bad, notFound, forbidden, conflict } = require('../utils/errors');
const { parseJSON, todayIST } = require('../utils/helpers');

const ASSIGNABLE = ['confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched'];

async function staffForUser(trx, userId) {
  const s = await trx('delivery_staff').where({ user_id: userId }).first();
  if (!s) throw forbidden('No delivery profile for this account');
  return s;
}

async function assign(admin, { orderIds, staffId }) {
  return db.transaction(async (trx) => {
    const staff = await trx('delivery_staff').where({ id: staffId }).first();
    if (!staff) throw notFound('Delivery staff');
    const maxSeq = (await trx('delivery_assignments').where({ staff_id: staffId }).whereIn('status', ['assigned', 'picked_up', 'out_for_delivery']).max({ m: 'route_sequence' }).first()).m || 0;
    let seq = maxSeq;
    for (const id of orderIds) {
      const o = await trx('orders').where({ id }).first();
      if (!o) throw notFound(`Order #${id}`);
      if (!ASSIGNABLE.includes(o.status)) throw conflict(`${o.order_number} is "${o.status}" and cannot be assigned`);
      await trx('delivery_assignments').where({ order_id: id }).whereIn('status', ['assigned', 'picked_up']).update({ status: 'reassigned' });
      await trx('delivery_assignments').insert({ order_id: id, staff_id: staffId, assigned_by: admin.id, route_sequence: ++seq });
    }
    return orderIds.length;
  });
}

const mapsLink = (a) => (a.lat && a.lng
  ? `https://www.google.com/maps/dir/?api=1&destination=${a.lat},${a.lng}`
  : `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent([a.line1, a.line2, a.city, a.pincode].filter(Boolean).join(', '))}`);

/** Nearest-neighbour ordering from the plant when coordinates exist; otherwise keep admin sequence. */
function planRoute(stops, origin) {
  const withGeo = stops.filter((s) => s.address.lat && s.address.lng);
  if (!origin || withGeo.length < 2) return stops;
  const rest = [...withGeo]; const out = []; let cur = origin;
  const d = (a, b) => (a.lat - b.lat) ** 2 + (a.lng - b.lng) ** 2;
  while (rest.length) {
    rest.sort((a, b) => d(cur, a.address) - d(cur, b.address));
    const next = rest.shift(); out.push(next); cur = next.address;
  }
  return [...out, ...stops.filter((s) => !(s.address.lat && s.address.lng))];
}

async function myRun(user, { date, status } = {}) {
  const staff = await staffForUser(db, user.id);
  const q = db('delivery_assignments as da').join('orders as o', 'o.id', 'da.order_id').join('users as u', 'u.id', 'o.user_id')
    .where('da.staff_id', staff.id)
    .select('da.*', 'o.order_number', 'o.status as order_status', 'o.grand_total', 'o.amount_paid', 'o.payment_method', 'o.payment_status',
      'o.address_snapshot', 'o.delivery_slot', 'o.delivery_date', 'o.notes', 'u.name as customer_name', 'u.phone as customer_phone', 'o.user_id')
    .orderBy('da.route_sequence');
  if (status === 'active') q.whereIn('da.status', ['assigned', 'picked_up', 'out_for_delivery']);
  else if (status === 'history') q.whereIn('da.status', ['delivered', 'failed']);
  if (date) q.andWhere((w) => w.where('o.delivery_date', date).orWhereRaw("date(da.created_at) = ?", [date]));
  const rows = await q;
  const settings = require('./settings.service');
  const plant = (await settings.get('business_profile', {})).plant_location;
  const stops = [];
  for (const r of rows) {
    const address = parseJSON(r.address_snapshot, {});
    delete r.address_snapshot;
    const items = await db('order_items as oi').join('products as p', 'p.id', 'oi.product_id').where('oi.order_id', r.order_id).select('oi.product_name', 'oi.quantity', 'p.is_returnable_jar');
    const jarBal = await db('jar_balances').where({ user_id: r.user_id }).first('jars_pending');
    stops.push({ ...r, address, items, jarsPending: jarBal?.jars_pending || 0, amountDue: r.grand_total - r.amount_paid, mapsUrl: mapsLink(address) });
  }
  const planned = status === 'active' ? planRoute(stops, plant) : stops;
  const geo = planned.filter((s) => s.address.lat && s.address.lng);
  const routeUrl = geo.length
    ? `https://www.google.com/maps/dir/?api=1${plant ? `&origin=${plant.lat},${plant.lng}` : ''}&destination=${geo.at(-1).address.lat},${geo.at(-1).address.lng}&waypoints=${geo.slice(0, -1).slice(0, 9).map((s) => `${s.address.lat},${s.address.lng}`).join('|')}`
    : null;
  return { staff, stops: planned, routeUrl };
}

async function ownAssignment(trx, user, id) {
  const staff = await staffForUser(trx, user.id);
  const a = await trx('delivery_assignments').where({ id, staff_id: staff.id }).first();
  if (!a) throw notFound('Assignment');
  return a;
}

async function pickUp(user, id) {
  return db.transaction(async (trx) => {
    const a = await ownAssignment(trx, user, id);
    if (a.status !== 'assigned') throw conflict('Already picked up');
    const o = await trx('orders').where({ id: a.order_id }).first();
    // Walk the order forward to dispatched through the intermediate states.
    const path = ['confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched'];
    for (let i = path.indexOf(o.status) + 1; i > 0 && i < path.length; i++) await orders.transition(trx, o.id, path[i], user, i === path.length - 1 ? 'Picked up by delivery partner' : null);
    await trx('delivery_assignments').where({ id }).update({ status: 'picked_up', updated_at: trx.fn.now() });
  });
}

async function start(user, id) {
  return db.transaction(async (trx) => {
    const a = await ownAssignment(trx, user, id);
    if (!['picked_up', 'assigned'].includes(a.status)) throw conflict('Cannot start this delivery');
    if (a.status === 'assigned') { await trx('delivery_assignments').where({ id }).update({ status: 'picked_up' }); }
    const o = await trx('orders').where({ id: a.order_id }).first();
    if (o.status !== 'dispatched') throw conflict('Pick up the order before starting delivery');
    await orders.transition(trx, o.id, 'out_for_delivery', user);
    await trx('delivery_assignments').where({ id }).update({ status: 'out_for_delivery', updated_at: trx.fn.now() });
  });
}

async function complete(user, id, { otp, cashCollected = 0, emptyJarsCollected = 0, notes }) {
  return db.transaction(async (trx) => {
    const a = await ownAssignment(trx, user, id);
    if (a.status !== 'out_for_delivery') throw conflict('Start the delivery first');
    const o = await trx('orders').where({ id: a.order_id }).first();
    if (String(otp) !== String(o.delivery_otp)) throw bad('Incorrect delivery OTP. Ask the customer for the 4-digit code.');
    const due = o.grand_total - o.amount_paid;
    if (o.payment_method === 'cod' && cashCollected < due) throw bad(`Collect ₹${due / 100} before completing this COD delivery`);
    if (cashCollected) await payments.recordCash(trx, { orderId: o.id, amount: cashCollected, by: user.id });
    if (emptyJarsCollected) await jars.record(trx, { userId: o.user_id, orderId: o.id, type: 'returned', jars: emptyJarsCollected, note: 'Collected at delivery', by: user.id });
    await orders.transition(trx, o.id, 'delivered', user, 'Delivered, OTP verified');
    if (emptyJarsCollected) {
      await trx('packaging_materials').where('name', 'like', '%Empty 20L%').increment('quantity', emptyJarsCollected);
    }
    await trx('delivery_assignments').where({ id }).update({ status: 'delivered', cash_collected: cashCollected, empty_jars_collected: emptyJarsCollected, notes, delivered_at: trx.fn.now() });
  });
}

async function fail(user, id, reason) {
  return db.transaction(async (trx) => {
    const a = await ownAssignment(trx, user, id);
    if (a.status !== 'out_for_delivery') throw conflict('Only active deliveries can be marked failed');
    await orders.transition(trx, a.order_id, 'dispatched', user, `Delivery attempt failed: ${reason}`);
    await trx('delivery_assignments').where({ id }).update({ status: 'failed', failure_reason: reason, updated_at: trx.fn.now() });
  });
}

async function dailyReport(staffId, date = todayIST()) {
  const rows = await db('delivery_assignments').where({ staff_id: staffId }).andWhereRaw("date(COALESCE(delivered_at, updated_at)) = ?", [date]);
  return {
    date,
    assigned: rows.length,
    delivered: rows.filter((r) => r.status === 'delivered').length,
    failed: rows.filter((r) => r.status === 'failed').length,
    cashCollected: rows.reduce((s, r) => s + r.cash_collected, 0),
    emptyJarsCollected: rows.reduce((s, r) => s + r.empty_jars_collected, 0),
  };
}

module.exports = { assign, myRun, pickUp, start, complete, fail, dailyReport, staffForUser };
