/**
 * Finished-goods inventory with batch (FIFO-by-expiry) allocation.
 *
 * Invariant: sum(active batches.quantity_remaining) == inventory.available + inventory.reserved
 *
 * Lifecycle per order line:
 *   place   → reserve   (available -= q, reserved += q)       prevents overselling
 *   confirm → deduct    (reserved -= q, batches FIFO -= q)    the "automatic deduction"
 *   cancel before confirm → release (reserved -= q, available += q)
 *   cancel after confirm  → restock (batches += q, available += q)
 */
const db = require('../database/db');
const { conflict, bad, notFound } = require('../utils/errors');
const { todayIST } = require('../utils/helpers');
const notify = require('./notification.service');

const move = (trx, row) => trx('stock_movements').insert(row);

async function ensureRow(trx, productId) {
  const inv = await trx('inventory').where({ product_id: productId }).first();
  if (inv) return inv;
  await trx('inventory').insert({ product_id: productId });
  return trx('inventory').where({ product_id: productId }).first();
}

async function addBatch(trx, { productId, batchNumber, manufacturingDate, expiryDate, quantity, notes }, userId) {
  if (quantity <= 0) throw bad('Quantity must be positive');
  if (expiryDate <= manufacturingDate) throw bad('Expiry date must be after manufacturing date');
  await ensureRow(trx, productId);
  const [id] = await trx('inventory_batches').insert({
    product_id: productId, batch_number: batchNumber, manufacturing_date: manufacturingDate, expiry_date: expiryDate,
    quantity_produced: quantity, quantity_remaining: quantity, notes, created_by: userId,
  });
  await trx('inventory').where({ product_id: productId }).increment('quantity_available', quantity).update({ updated_at: trx.fn.now() });
  await move(trx, { product_id: productId, batch_id: id, type: 'production', quantity, reference_type: 'batch', reference_id: String(id), created_by: userId });
  const product = await trx('products').where({ id: productId }).first('status');
  if (product?.status === 'out_of_stock') await trx('products').where({ id: productId }).update({ status: 'active' });
  return id;
}

async function reserve(trx, productId, qty, orderId) {
  // Conditional update is the overselling guard: it only succeeds if stock is still there.
  const n = await trx('inventory').where({ product_id: productId }).andWhere('quantity_available', '>=', qty)
    .update({ quantity_available: trx.raw('quantity_available - ?', [qty]), quantity_reserved: trx.raw('quantity_reserved + ?', [qty]), updated_at: trx.fn.now() });
  if (!n) throw conflict('Stock changed while you were checking out. Please review your cart.');
  await move(trx, { product_id: productId, type: 'reserve', quantity: -qty, reference_type: 'order', reference_id: String(orderId) });
}

async function release(trx, productId, qty, orderId) {
  await trx('inventory').where({ product_id: productId })
    .update({ quantity_available: trx.raw('quantity_available + ?', [qty]), quantity_reserved: trx.raw('MAX(quantity_reserved - ?, 0)', [qty]) });
  await move(trx, { product_id: productId, type: 'release', quantity: qty, reference_type: 'order', reference_id: String(orderId) });
}

/** FIFO by earliest expiry among non-expired active batches. */
async function deductForItem(trx, item, orderId) {
  let need = item.quantity;
  const batches = await trx('inventory_batches').where({ product_id: item.product_id, status: 'active' })
    .andWhere('quantity_remaining', '>', 0).andWhere('expiry_date', '>=', todayIST())
    .orderBy([{ column: 'expiry_date' }, { column: 'id' }]);
  for (const b of batches) {
    if (!need) break;
    const take = Math.min(need, b.quantity_remaining);
    const left = b.quantity_remaining - take;
    await trx('inventory_batches').where({ id: b.id }).update({ quantity_remaining: left, status: left === 0 ? 'depleted' : 'active', updated_at: trx.fn.now() });
    await trx('order_item_batches').insert({ order_item_id: item.id, batch_id: b.id, quantity: take });
    await move(trx, { product_id: item.product_id, batch_id: b.id, type: 'dispatch', quantity: -take, reference_type: 'order', reference_id: String(orderId) });
    need -= take;
  }
  if (need) throw conflict(`Not enough unexpired batch stock for ${item.product_name}. Add a production batch first.`);
  await trx('inventory').where({ product_id: item.product_id })
    .update({ quantity_reserved: trx.raw('MAX(quantity_reserved - ?, 0)', [item.quantity]), updated_at: trx.fn.now() });
}

async function restockItem(trx, item, orderId) {
  const allocs = await trx('order_item_batches').where({ order_item_id: item.id });
  for (const a of allocs) {
    await trx('inventory_batches').where({ id: a.batch_id }).update({ quantity_remaining: trx.raw('quantity_remaining + ?', [a.quantity]), status: 'active' });
    await move(trx, { product_id: item.product_id, batch_id: a.batch_id, type: 'return', quantity: a.quantity, reference_type: 'order', reference_id: String(orderId) });
  }
  await trx('inventory').where({ product_id: item.product_id }).increment('quantity_available', item.quantity);
}

/** Manual adjustment (positive or negative) against a specific batch. */
async function adjust(trx, { productId, batchId, quantity, reason, type = 'adjustment' }, userId) {
  if (!quantity) throw bad('Quantity cannot be zero');
  const batch = await trx('inventory_batches').where({ id: batchId, product_id: productId }).first();
  if (!batch) throw notFound('Batch');
  const inv = await ensureRow(trx, productId);
  if (quantity < 0 && (batch.quantity_remaining < -quantity || inv.quantity_available < -quantity)) throw bad('Adjustment exceeds available stock');
  const left = batch.quantity_remaining + quantity;
  await trx('inventory_batches').where({ id: batchId }).update({ quantity_remaining: left, status: left === 0 ? 'depleted' : batch.status === 'depleted' ? 'active' : batch.status });
  const upd = { quantity_available: trx.raw('quantity_available + ?', [quantity]), updated_at: trx.fn.now() };
  if (type === 'damage') upd.quantity_damaged = trx.raw('quantity_damaged + ?', [-quantity]);
  await trx('inventory').where({ product_id: productId }).update(upd);
  await move(trx, { product_id: productId, batch_id: batchId, type, quantity, note: reason, created_by: userId });
}

async function checkLowStock(trx, productIds) {
  const rows = await trx('inventory as i').join('products as p', 'p.id', 'i.product_id')
    .whereIn('i.product_id', productIds).andWhereRaw('i.quantity_available <= i.low_stock_threshold')
    .select('p.id', 'p.name', 'i.quantity_available');
  for (const r of rows) {
    await notify.toRole(trx, 'super_admin', { type: 'low_stock', title: `Low stock: ${r.name}`, body: `Only ${r.quantity_available} units left.`, data: { productId: r.id } });
    if (r.quantity_available === 0) await trx('products').where({ id: r.id, status: 'active' }).update({ status: 'out_of_stock' });
  }
}

/** Daily job: retire expired batches from sellable stock. */
async function expireBatches() {
  return db.transaction(async (trx) => {
    const expired = await trx('inventory_batches').where({ status: 'active' }).andWhere('expiry_date', '<', todayIST()).andWhere('quantity_remaining', '>', 0);
    for (const b of expired) {
      const inv = await ensureRow(trx, b.product_id);
      const remove = Math.min(b.quantity_remaining, inv.quantity_available);
      await trx('inventory_batches').where({ id: b.id }).update({ status: 'expired', quantity_remaining: b.quantity_remaining - remove });
      await trx('inventory').where({ product_id: b.product_id }).decrement('quantity_available', remove);
      await move(trx, { product_id: b.product_id, batch_id: b.id, type: 'expiry', quantity: -remove, note: 'Auto-expired' });
    }
    return expired.length;
  });
}

module.exports = { ensureRow, addBatch, reserve, release, deductForItem, restockItem, adjust, checkLowStock, expireBatches };
