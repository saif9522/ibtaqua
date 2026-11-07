/**
 * Multi-level pricing engine. Single source of truth for what a buyer pays.
 *
 * Resolution order for a product, for the buyer's tier:
 *   1. negotiated price for this user        (product_prices.user_id = user)
 *   2. zone price for the delivery zone      (product_prices.zone_id = zone)
 *   3. base tier price                       (user_id NULL, zone_id NULL)
 * Then product-wise discount_percent on that row, then the best quantity break.
 * A product with no price row for the tier is not sold to that tier.
 *
 * Prices are stored GST-inclusive or exclusive depending on setting
 * `prices_include_gst` (default true, the Indian retail convention).
 */
const db = require('../database/db');
const settings = require('./settings.service');
const { todayIST, pct, splitInclusive } = require('../utils/helpers');

const activeRowsQuery = (trx, productIds, tier) => {
  const today = todayIST();
  return trx('product_prices')
    .whereIn('product_id', productIds)
    .andWhere({ tier, is_active: true })
    .andWhere((q) => q.whereNull('valid_from').orWhere('valid_from', '<=', today))
    .andWhere((q) => q.whereNull('valid_to').orWhere('valid_to', '>=', today));
};

function pickRow(rows, userId, zoneId) {
  const negotiated = userId && rows.find((r) => r.user_id === userId);
  if (negotiated) return { row: negotiated, source: 'negotiated' };
  const zone = zoneId && rows.find((r) => !r.user_id && r.zone_id === zoneId);
  if (zone) return { row: zone, source: 'zone' };
  const base = rows.find((r) => !r.user_id && !r.zone_id);
  return base ? { row: base, source: 'base' } : null;
}

/** Load everything needed to price many products for one buyer. */
async function loadContext(productIds, { tier = 'customer', userId = null, zoneId = null } = {}, trx = db) {
  const ids = [...new Set(productIds)];
  if (!ids.length) return { tier, userId, zoneId, rows: new Map(), breaks: new Map() };
  const priceRows = await activeRowsQuery(trx, ids, tier)
    .andWhere((q) => q.whereNull('user_id').orWhere('user_id', userId || -1));
  const breakRows = await trx('quantity_discounts').whereIn('product_id', ids).andWhere({ tier }).orderBy('min_qty', 'desc');
  const rows = new Map(); const breaks = new Map();
  for (const r of priceRows) (rows.get(r.product_id) || rows.set(r.product_id, []).get(r.product_id)).push(r);
  for (const b of breakRows) (breaks.get(b.product_id) || breaks.set(b.product_id, []).get(b.product_id)).push(b);
  return { tier, userId, zoneId, rows, breaks };
}

/** Unit price for a product at a quantity. Returns null if not sold to this tier. */
function priceFromContext(ctx, productId, qty = 1) {
  const picked = pickRow(ctx.rows.get(productId) || [], ctx.userId, ctx.zoneId);
  if (!picked) return null;
  const { row, source } = picked;
  const afterProductDiscount = row.price - pct(row.price, row.discount_percent);
  const brk = (ctx.breaks.get(productId) || []).find((b) => qty >= b.min_qty);
  const qtyDiscountPercent = brk ? Number(brk.discount_percent) : 0;
  const unitPrice = afterProductDiscount - pct(afterProductDiscount, qtyDiscountPercent);
  return {
    tier: ctx.tier,
    listPrice: row.price,
    unitPrice,
    minOrderQty: row.min_order_qty,
    productDiscountPercent: Number(row.discount_percent),
    qtyDiscountPercent,
    source,
    quantityBreaks: (ctx.breaks.get(productId) || []).map((b) => ({ minQty: b.min_qty, discountPercent: Number(b.discount_percent) })).reverse(),
  };
}

/**
 * Price a cart server-side. Input lines: [{ productId, quantity }]. Client prices are ignored.
 * Throws AppError-compatible objects via `errors` array rather than throwing, so callers can report all.
 */
async function priceLines(lines, buyer, trx = db) {
  const ids = lines.map((l) => l.productId);
  const products = await trx('products').whereIn('id', ids).select();
  const byId = new Map(products.map((p) => [p.id, p]));
  const inventory = new Map((await trx('inventory').whereIn('product_id', ids)).map((i) => [i.product_id, i]));
  const ctx = await loadContext(ids, buyer, trx);
  const inclusive = await settings.get('prices_include_gst', true);
  const jarDeposit = await settings.get('jar_deposit_amount', 0);
  const jarDepositMode = await settings.get('jar_deposit_mode', 'per_new_jar'); // per_new_jar | none

  const items = []; const errors = [];
  for (const line of lines) {
    const p = byId.get(line.productId);
    if (!p || p.status !== 'active') { errors.push({ productId: line.productId, message: 'Product is unavailable' }); continue; }
    const price = priceFromContext(ctx, p.id, line.quantity);
    if (!price) { errors.push({ productId: p.id, message: `${p.name} is not available for your account type` }); continue; }
    if (line.quantity < price.minOrderQty) { errors.push({ productId: p.id, message: `${p.name}: minimum order is ${price.minOrderQty}` }); continue; }
    const inv = inventory.get(p.id);
    if (!inv || inv.quantity_available < line.quantity) {
      errors.push({ productId: p.id, message: `${p.name}: only ${inv ? inv.quantity_available : 0} in stock` }); continue;
    }
    const gross = price.unitPrice * line.quantity;
    let taxable; let gst;
    if (inclusive) ({ taxable, gst } = splitInclusive(gross, p.gst_percent));
    else { taxable = gross; gst = pct(gross, p.gst_percent); }
    items.push({
      product: p,
      productId: p.id,
      quantity: line.quantity,
      mrp: p.mrp,
      unitPrice: price.unitPrice,
      gstPercent: Number(p.gst_percent),
      taxableAmount: taxable,
      gstAmount: gst,
      lineTotal: taxable + gst,
      priceSource: price.source,
      jarDepositUnit: p.is_returnable_jar && jarDepositMode !== 'none' ? jarDeposit : 0,
    });
  }
  return { items, errors, inclusive };
}

/** Public-safe price view for catalog listings: only the caller's tier is ever returned. */
async function priceCatalog(products, buyer) {
  const ctx = await loadContext(products.map((p) => p.id), buyer);
  return products.map((p) => {
    const price = priceFromContext(ctx, p.id, 1);
    return price ? { ...p, price } : { ...p, price: null };
  });
}

module.exports = { loadContext, priceFromContext, priceLines, priceCatalog };
