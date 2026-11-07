/**
 * 20L returnable-jar ledger. jar_balances is a running summary of jar_transactions.
 * jars_pending = jars currently with the buyer (to be returned).
 */
const db = require('../database/db');
const settings = require('./settings.service');
const notify = require('./notification.service');
const { bad } = require('../utils/errors');

async function balance(trx, userId) {
  let b = await trx('jar_balances').where({ user_id: userId }).first();
  if (!b) { await trx('jar_balances').insert({ user_id: userId }); b = await trx('jar_balances').where({ user_id: userId }).first(); }
  return b;
}

/** Deposit due for an order of `qty` returnable jars: only jars beyond those already held are new. */
async function depositFor(trx, userId, tier, qty) {
  const amount = await settings.get('jar_deposit_amount', 0);
  const tiers = await settings.get('jar_deposit_tiers', ['customer']);
  if (!amount || !tiers.includes(tier) || qty <= 0) return { newJars: 0, deposit: 0 };
  const b = await balance(trx, userId);
  const coveredJars = Math.floor(b.deposit_held / amount);
  const newJars = Math.max(0, qty - Math.max(coveredJars, b.jars_pending));
  return { newJars, deposit: newJars * amount };
}

async function record(trx, { userId, orderId = null, type, jars = 0, amount = 0, note, by = null }) {
  const b = await balance(trx, userId);
  const upd = { updated_at: trx.fn.now() };
  if (type === 'issued') { upd.jars_delivered = b.jars_delivered + jars; upd.jars_pending = b.jars_pending + jars; }
  if (type === 'returned') {
    if (jars > b.jars_pending) throw bad(`Only ${b.jars_pending} jars are pending with this customer`);
    upd.jars_returned = b.jars_returned + jars; upd.jars_pending = b.jars_pending - jars;
  }
  if (type === 'damaged' || type === 'lost') upd.jars_pending = Math.max(0, b.jars_pending - jars);
  if (type === 'adjustment') upd.jars_pending = Math.max(0, b.jars_pending + jars);
  if (type === 'deposit_collected') upd.deposit_held = b.deposit_held + amount;
  if (type === 'deposit_refunded') {
    if (amount > b.deposit_held) throw bad('Refund exceeds deposit held');
    upd.deposit_held = b.deposit_held - amount;
  }
  await trx('jar_balances').where({ user_id: userId }).update(upd);
  await trx('jar_transactions').insert({ user_id: userId, order_id: orderId, type, jars, amount, note, recorded_by: by });
  const limit = await settings.get('jar_shortage_alert_threshold', 10);
  const after = await trx('jar_balances').where({ user_id: userId }).first();
  if (type === 'issued' && after.jars_pending >= limit) {
    await notify.toRole(trx, 'super_admin', { type: 'jar_shortage', title: 'High pending jars', body: `User #${userId} holds ${after.jars_pending} empty jars.`, data: { userId } });
  }
  return after;
}

async function summary() {
  const t = await db('jar_balances').sum({ delivered: 'jars_delivered', returned: 'jars_returned', pending: 'jars_pending', deposit: 'deposit_held' }).first();
  const stock = await db('packaging_materials').where('name', 'like', '%Empty 20L%').first();
  return { ...t, emptyJarsInPlant: stock?.quantity ?? null };
}

module.exports = { balance, depositFor, record, summary };
