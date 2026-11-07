/**
 * Order lifecycle. Every money figure is computed here from DB data — never from the client.
 */
const db = require('../database/db');
const settings = require('./settings.service');
const pricing = require('./pricing.service');
const inventory = require('./inventory.service');
const jars = require('./jar.service');
const notify = require('./notification.service');
const invoices = require('./invoice.service');
const { bad, notFound, forbidden, conflict, AppError } = require('../utils/errors');
const { genNumber, randomDigits, parseJSON, todayIST, addDays, pct, splitInclusive, sqlTime } = require('../utils/helpers');
const { B2B_ROLES } = require('../config/rbac');

const TRANSITIONS = {
  pending: ['confirmed', 'cancelled'],
  confirmed: ['processing', 'cancelled'],
  processing: ['packed', 'cancelled'],
  packed: ['ready_for_dispatch', 'cancelled'],
  ready_for_dispatch: ['dispatched', 'cancelled'],
  dispatched: ['out_for_delivery'],
  out_for_delivery: ['delivered', 'dispatched'], // back to dispatched = failed attempt
  delivered: ['return_requested'],
  return_requested: ['returned', 'delivered'], // delivered = return rejected
  cancelled: [],
  returned: [],
};
const CONFIRMED_STATES = ['confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'out_for_delivery', 'delivered', 'return_requested', 'returned'];
const STATUS_NOTIFY = {
  confirmed: ['order_confirmed', 'Order confirmed'],
  dispatched: ['order_dispatched', 'Order dispatched'],
  out_for_delivery: ['out_for_delivery', 'Out for delivery'],
  delivered: ['delivered', 'Order delivered'],
  cancelled: ['order_cancelled', 'Order cancelled'],
};

async function resolveZone(trx, pincode) {
  const zones = await trx('delivery_zones').where({ is_active: true });
  return zones.find((z) => parseJSON(z.pincodes, []).includes(String(pincode))) || null;
}

async function outstandingFor(trx, userId) {
  const r = await trx('orders').where({ user_id: userId, payment_method: 'credit' }).whereNotIn('status', ['cancelled', 'returned'])
    .sum({ due: trx.raw('grand_total - amount_paid') }).first();
  return r?.due || 0;
}

async function evaluateCoupon(trx, code, user, grossAfterItems) {
  const c = await trx('coupons').whereRaw('UPPER(code) = ?', [code.toUpperCase()]).first();
  const now = sqlTime();
  if (!c || !c.is_active) throw bad('Invalid coupon code');
  if ((c.valid_from && c.valid_from > now) || (c.valid_to && c.valid_to < now)) throw bad('This coupon has expired');
  if (!parseJSON(c.applicable_tiers, []).includes(user.tier)) throw bad('This coupon is not valid for your account type');
  if (grossAfterItems < c.min_order_value) throw bad(`Add items worth ₹${(c.min_order_value - grossAfterItems) / 100} more to use this coupon`);
  if (c.usage_limit && c.used_count >= c.usage_limit) throw bad('This coupon is fully redeemed');
  const used = await trx('coupon_usage').where({ coupon_id: c.id, user_id: user.id }).count({ n: '*' }).first();
  if (used.n >= c.per_user_limit) throw bad('You have already used this coupon');
  let discount = c.discount_type === 'percent' ? pct(grossAfterItems, c.value) : c.value;
  if (c.max_discount) discount = Math.min(discount, c.max_discount);
  return { coupon: c, discount: Math.min(discount, grossAfterItems) };
}

/**
 * Build a full quote. Used by both /checkout/quote (preview) and placeOrder (commit) so
 * the user sees exactly what they will be charged.
 */
async function quote(trx, user, { items, addressId, couponCode, paymentMethod }) {
  if (!items?.length) throw bad('Your cart is empty');
  const merged = new Map();
  for (const i of items) merged.set(i.productId, (merged.get(i.productId) || 0) + i.quantity);
  const lines = [...merged].map(([productId, quantity]) => ({ productId, quantity }));

  const address = addressId ? await trx('user_addresses').where({ id: addressId, user_id: user.id }).first() : null;
  if (addressId && !address) throw notFound('Address');
  const zone = address ? await resolveZone(trx, address.pincode) : null;
  if (address && !zone) throw bad(`Sorry, we don't deliver to pincode ${address.pincode} yet`);

  const { items: priced, errors } = await pricing.priceLines(lines, { tier: user.tier, userId: user.id, zoneId: zone?.id }, trx);
  if (errors.length) throw new AppError(422, errors[0].message, 'CART_INVALID', errors);

  let gross = priced.reduce((s, i) => s + i.lineTotal, 0);
  let couponDiscount = 0; let coupon = null;
  if (couponCode) ({ coupon, discount: couponDiscount } = await evaluateCoupon(trx, couponCode, user, gross));

  // Spread the coupon across lines pro-rata so GST is charged on the discounted value.
  let remaining = couponDiscount;
  priced.forEach((it, idx) => {
    const share = idx === priced.length - 1 ? remaining : Math.round((couponDiscount * it.lineTotal) / gross);
    remaining -= share;
    it.discount = share;
    const net = it.lineTotal - share;
    const { taxable, gst } = splitInclusive(net, it.gstPercent);
    it.taxableAmount = taxable; it.gstAmount = gst; it.lineTotal = net;
  });

  const minOrder = { customer: zone?.min_order_value || 0, ...(await settings.get('min_order_value_by_tier', {})) };
  const itemsTotal = priced.reduce((s, i) => s + i.lineTotal, 0);
  if (itemsTotal < (minOrder[user.tier] || 0)) throw bad(`Minimum order value is ₹${minOrder[user.tier] / 100}`);

  let deliveryCharge = 0;
  if (zone) {
    const freeTiers = await settings.get('free_delivery_tiers', ['retailer', 'wholesaler', 'distributor']);
    deliveryCharge = freeTiers.includes(user.tier) || (zone.free_delivery_above && itemsTotal >= zone.free_delivery_above) ? 0 : zone.delivery_charge;
  }

  let jarDeposit = 0;
  const jarQty = priced.filter((i) => i.product.is_returnable_jar).reduce((s, i) => s + i.quantity, 0);
  if (jarQty) jarDeposit = (await jars.depositFor(trx, user.id, user.tier, jarQty)).deposit;

  const grandTotal = itemsTotal + deliveryCharge + jarDeposit;

  // Payment method eligibility
  const methods = await availableMethods(trx, user, grandTotal);
  if (paymentMethod && !methods.find((m) => m.id === paymentMethod && m.enabled)) {
    const m = methods.find((x) => x.id === paymentMethod);
    throw bad(m?.reason || 'This payment method is not available');
  }

  return {
    zone, address, coupon,
    items: priced,
    summary: {
      subtotal: priced.reduce((s, i) => s + i.taxableAmount + i.gstAmount + i.discount, 0),
      discountTotal: couponDiscount,
      taxableTotal: priced.reduce((s, i) => s + i.taxableAmount, 0),
      gstTotal: priced.reduce((s, i) => s + i.gstAmount, 0),
      deliveryCharge, jarDeposit, grandTotal,
      mrpSavings: priced.reduce((s, i) => s + (i.mrp - i.unitPrice) * i.quantity, 0) + couponDiscount,
    },
    paymentMethods: methods,
  };
}

async function availableMethods(trx, user, total) {
  const cfg = await settings.get('payment_methods', { razorpay: true, upi: true, cod: true, bank_transfer: true, credit: true });
  const codMax = await settings.get('cod_max_amount', 500000);
  const m = [
    { id: 'razorpay', label: 'Pay online (Card / Netbanking / UPI)', enabled: !!cfg.razorpay },
    { id: 'upi', label: 'UPI (Razorpay)', enabled: !!cfg.upi },
    { id: 'cod', label: 'Cash on Delivery', enabled: !!cfg.cod && total <= codMax, reason: total > codMax ? `COD is available up to ₹${codMax / 100}` : undefined },
    { id: 'bank_transfer', label: 'Bank Transfer (NEFT/RTGS/IMPS)', enabled: !!cfg.bank_transfer && B2B_ROLES.includes(user.role) },
  ];
  if (B2B_ROLES.includes(user.role)) {
    const biz = await trx(`${user.role}s`).where({ user_id: user.id }).first();
    const out = await outstandingFor(trx, user.id);
    const ok = cfg.credit && biz?.credit_enabled && out + total <= biz.credit_limit;
    m.push({
      id: 'credit', label: `Monthly credit (available ₹${Math.max(0, (biz?.credit_limit || 0) - out) / 100})`, enabled: !!ok,
      reason: !biz?.credit_enabled ? 'Credit is not enabled for your account. Request a credit limit from your dashboard.' : 'This order exceeds your available credit',
    });
  }
  return m;
}

async function placeOrder(user, input) {
  const autoConfirm = await settings.get('auto_confirm_orders', { cod: true, credit: true, bank_transfer: false, razorpay: false, upi: false });
  return db.transaction(async (trx) => {
    if (!input.addressId) throw bad('Please choose a delivery address');
    const q = await quote(trx, user, input);
    const orderNumber = genNumber('IBT');
    const creditDays = input.paymentMethod === 'credit' ? (await trx(`${user.role}s`).where({ user_id: user.id }).first())?.credit_days || 30 : null;
    const [orderId] = await trx('orders').insert({
      order_number: orderNumber, user_id: user.id, buyer_tier: user.tier, status: 'pending',
      payment_method: input.paymentMethod, payment_status: input.paymentMethod === 'bank_transfer' ? 'unpaid' : 'unpaid',
      subtotal: q.summary.subtotal, discount_total: q.summary.discountTotal, taxable_total: q.summary.taxableTotal, gst_total: q.summary.gstTotal,
      delivery_charge: q.summary.deliveryCharge, jar_deposit_total: q.summary.jarDeposit, grand_total: q.summary.grandTotal,
      coupon_id: q.coupon?.id || null, address_id: q.address.id, address_snapshot: JSON.stringify(q.address), zone_id: q.zone.id,
      delivery_date: input.deliveryDate || null, delivery_slot: input.deliverySlot || null, delivery_otp: randomDigits(4),
      notes: input.notes || null, source: input.source || 'web', subscription_id: input.subscriptionId || null,
      due_date: creditDays ? addDays(todayIST(), creditDays) : null,
    });
    for (const it of q.items) {
      await trx('order_items').insert({
        order_id: orderId, product_id: it.productId, product_name: it.product.name, sku: it.product.sku, quantity: it.quantity,
        mrp: it.mrp, unit_price: it.unitPrice, gst_percent: it.gstPercent, taxable_amount: it.taxableAmount, gst_amount: it.gstAmount,
        line_total: it.lineTotal, jar_deposit: it.jarDepositUnit, price_source: it.priceSource,
      });
      await inventory.reserve(trx, it.productId, it.quantity, orderId);
    }
    if (q.coupon) {
      await trx('coupon_usage').insert({ coupon_id: q.coupon.id, user_id: user.id, order_id: orderId, discount_amount: q.summary.discountTotal });
      await trx('coupons').where({ id: q.coupon.id }).increment('used_count', 1);
    }
    await trx('order_status_history').insert({ order_id: orderId, to_status: 'pending', note: 'Order placed', changed_by: user.id });
    await inventory.checkLowStock(trx, q.items.map((i) => i.productId));
    await notify.toRole(trx, 'super_admin', { type: 'new_order', title: `New order ${orderNumber}`, body: `₹${q.summary.grandTotal / 100} · ${user.tier}`, data: { orderId } });
    if (autoConfirm[input.paymentMethod]) await transition(trx, orderId, 'confirmed', { id: null, system: true }, 'Auto-confirmed');
    return trx('orders').where({ id: orderId }).first();
  });
}

/** Central state machine. `actor` is a user object or { system: true }. */
async function transition(trx, orderId, to, actor, note) {
  const order = await trx('orders').where({ id: orderId }).first();
  if (!order) throw notFound('Order');
  if (!TRANSITIONS[order.status]?.includes(to)) throw conflict(`Cannot move order from "${order.status}" to "${to}"`);
  const items = await trx('order_items').where({ order_id: orderId });
  const wasConfirmed = CONFIRMED_STATES.includes(order.status);
  const upd = { status: to, updated_at: trx.fn.now() };

  if (to === 'confirmed') for (const it of items) await inventory.deductForItem(trx, it, orderId);

  if (to === 'cancelled') {
    for (const it of items) {
      if (wasConfirmed) await inventory.restockItem(trx, it, orderId);
      else await inventory.release(trx, it.product_id, it.quantity, orderId);
    }
    upd.cancelled_at = trx.fn.now(); upd.cancel_reason = note || null;
    if (order.coupon_id) {
      await trx('coupon_usage').where({ order_id: orderId }).del();
      await trx('coupons').where({ id: order.coupon_id }).andWhere('used_count', '>', 0).decrement('used_count', 1);
    }
    await trx('delivery_assignments').where({ order_id: orderId }).whereNotIn('status', ['delivered']).update({ status: 'failed', failure_reason: 'Order cancelled' });
    if (order.amount_paid > 0) upd.payment_status = 'paid'; // refund is initiated separately; see payment.service.refund
  }

  if (to === 'dispatched' && order.status === 'ready_for_dispatch') await invoices.ensureInvoice(trx, orderId);

  if (to === 'delivered') {
    upd.delivered_at = trx.fn.now();
    await invoices.ensureInvoice(trx, orderId);
    const jarProducts = await trx('products').whereIn('id', items.map((i) => i.product_id)).andWhere('is_returnable_jar', true).pluck('id');
    const jarQty = items.filter((i) => jarProducts.includes(i.product_id)).reduce((s, i) => s + i.quantity, 0);
    if (jarQty) await jars.record(trx, { userId: order.user_id, orderId, type: 'issued', jars: jarQty, note: `Order ${order.order_number}`, by: actor.id });
    // Deposit is part of the order total, so it is held from delivery (unpaid deposit shows as outstanding).
    if (order.jar_deposit_total > 0) {
      await jars.record(trx, { userId: order.user_id, orderId, type: 'deposit_collected', amount: order.jar_deposit_total, note: `Order ${order.order_number}`, by: actor.id });
    }
  }

  await trx('orders').where({ id: orderId }).update(upd);
  await trx('order_status_history').insert({ order_id: orderId, from_status: order.status, to_status: to, note: note || null, changed_by: actor.id || null });

  const n = STATUS_NOTIFY[to];
  if (n) {
    const extra = to === 'out_for_delivery' ? ` Share OTP ${order.delivery_otp} with the delivery partner.` : '';
    await notify.toUser(trx, order.user_id, { type: n[0], title: `${n[1]} · ${order.order_number}`, body: `Your order ${order.order_number} is now ${to.replace(/_/g, ' ')}.${extra}`, data: { orderId } });
  }
  return trx('orders').where({ id: orderId }).first();
}

async function updateStatus(orderId, to, actor, note) {
  return db.transaction((trx) => transition(trx, orderId, to, actor, note));
}

async function cancelByBuyer(user, orderId, reason) {
  return db.transaction(async (trx) => {
    const o = await trx('orders').where({ id: orderId, user_id: user.id }).first();
    if (!o) throw notFound('Order');
    const allowed = await settings.get('buyer_cancellable_statuses', ['pending', 'confirmed']);
    if (!allowed.includes(o.status)) throw bad('This order can no longer be cancelled. Please contact support.');
    return transition(trx, orderId, 'cancelled', user, reason || 'Cancelled by buyer');
  });
}

async function requestReturn(user, orderId, reason) {
  return db.transaction(async (trx) => {
    const o = await trx('orders').where({ id: orderId, user_id: user.id }).first();
    if (!o) throw notFound('Order');
    if (o.status !== 'delivered') throw bad('Only delivered orders can be returned');
    const days = await settings.get('return_window_days', 2);
    if (new Date(`${String(o.delivered_at).replace(' ', 'T')}Z`).getTime() + days * 86400e3 < Date.now()) throw bad(`Returns are accepted within ${days} days of delivery`);
    await trx('return_requests').insert({ order_id: orderId, user_id: user.id, reason });
    return transition(trx, orderId, 'return_requested', user, reason);
  });
}

async function getOrderDetail(orderId, viewer) {
  const o = await db('orders as o').join('users as u', 'u.id', 'o.user_id').where('o.id', orderId)
    .first('o.*', 'u.name as buyer_name', 'u.phone as buyer_phone', 'u.email as buyer_email');
  if (!o) throw notFound('Order');
  const isStaff = viewer.permissions?.has('orders.read');
  const isOwner = o.user_id === viewer.id;
  const isAssignedDriver = viewer.role === 'delivery' && await db('delivery_assignments as da').join('delivery_staff as ds', 'ds.id', 'da.staff_id')
    .where({ 'da.order_id': orderId, 'ds.user_id': viewer.id }).first();
  if (!isStaff && !isOwner && !isAssignedDriver) throw forbidden();
  o.address = parseJSON(o.address_snapshot);
  delete o.address_snapshot;
  if (!isOwner && !isStaff) delete o.delivery_otp; // drivers must ask the customer
  o.items = await db('order_items').where({ order_id: orderId });
  o.timeline = await db('order_status_history').where({ order_id: orderId }).orderBy('id');
  o.payments = await db('payments').where({ order_id: orderId }).orderBy('id', 'desc')
    .select('id', 'method', 'amount', 'refunded_amount', 'status', 'reference_no', 'provider_payment_id', 'created_at');
  o.invoice = await db('invoices').where({ order_id: orderId }).first('id', 'invoice_number', 'invoice_date');
  o.delivery = await db('delivery_assignments as da').join('delivery_staff as ds', 'ds.id', 'da.staff_id').join('users as u', 'u.id', 'ds.user_id')
    .where('da.order_id', orderId).orderBy('da.id', 'desc').first('da.status', 'da.delivered_at', 'u.name as staff_name', 'u.phone as staff_phone', 'ds.vehicle_number');
  o.returnRequest = await db('return_requests').where({ order_id: orderId }).orderBy('id', 'desc').first();
  return o;
}

module.exports = { TRANSITIONS, quote, placeOrder, transition, updateStatus, cancelByBuyer, requestReturn, getOrderDetail, availableMethods, outstandingFor, resolveZone };
