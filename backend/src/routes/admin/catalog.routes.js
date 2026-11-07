const router = require('express').Router();
const db = require('../../database/db');
const audit = require('../../services/audit.service');
const inventory = require('../../services/inventory.service');
const { requirePerm } = require('../../middleware/auth');
const { validate } = require('../../middleware/common');
const { productUpload, verifyMagic, publicPath } = require('../../middleware/upload');
const { ah, notFound, bad, forbidden } = require('../../utils/errors');

const pricingGuard = (req, res, next) => (req.body?.prices && !req.user.permissions.has('pricing.write') ? next(forbidden('You can edit products but not prices')) : next());
const { slugify, paginate } = require('../../utils/helpers');
const v = require('../../validators');

// ---------- Categories ----------
const category = v.z.object({ name: v.z.string().trim().min(2).max(120), description: v.opt(v.z.string().max(500)), sortOrder: v.z.coerce.number().int().default(0), isActive: v.z.coerce.boolean().default(true), image: v.opt(v.z.string().max(255)) });
router.get('/categories', requirePerm('products.read'), ah(async (req, res) => res.json(await db('categories as c').select('c.*', db.raw('(SELECT COUNT(*) FROM products p WHERE p.category_id = c.id) as product_count')).orderBy('sort_order'))));
router.post('/categories', requirePerm('products.write'), validate({ body: category }), ah(async (req, res) => {
  const [id] = await db('categories').insert({ name: req.body.name, slug: slugify(req.body.name), description: req.body.description || null, sort_order: req.body.sortOrder, is_active: req.body.isActive, image: req.body.image || null });
  await audit.log(req, 'category.create', 'category', id);
  res.status(201).json(await db('categories').where({ id }).first());
}));
router.put('/categories/:id', requirePerm('products.write'), validate({ body: category }), ah(async (req, res) => {
  const n = await db('categories').where({ id: req.params.id }).update({ name: req.body.name, slug: slugify(req.body.name), description: req.body.description || null, sort_order: req.body.sortOrder, is_active: req.body.isActive, ...(req.body.image && { image: req.body.image }), updated_at: db.fn.now() });
  if (!n) throw notFound('Category');
  await audit.log(req, 'category.update', 'category', req.params.id);
  res.json(await db('categories').where({ id: req.params.id }).first());
}));
router.delete('/categories/:id', requirePerm('products.write'), ah(async (req, res) => {
  if (await db('products').where({ category_id: req.params.id }).first()) throw bad('Move or delete the products in this category first');
  await db('categories').where({ id: req.params.id }).del();
  await audit.log(req, 'category.delete', 'category', req.params.id);
  res.json({ ok: true });
}));

// ---------- Products ----------
router.get('/products', requirePerm('products.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('products as p').join('categories as c', 'c.id', 'p.category_id').leftJoin('inventory as i', 'i.product_id', 'p.id');
  if (req.query.search) q.where((w) => w.whereRaw('LOWER(p.name) LIKE ?', [`%${String(req.query.search).toLowerCase()}%`]).orWhereRaw('LOWER(p.sku) LIKE ?', [`%${String(req.query.search).toLowerCase()}%`]));
  if (req.query.category) q.andWhere('p.category_id', Number(req.query.category));
  if (req.query.status) q.andWhere('p.status', String(req.query.status));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  const rows = await q.select('p.*', 'c.name as category_name', 'i.quantity_available', 'i.quantity_reserved', 'i.low_stock_threshold').orderBy('p.id').limit(limit).offset(offset);
  const prices = await db('product_prices').whereIn('product_id', rows.map((r) => r.id)).whereNull('user_id').whereNull('zone_id').andWhere('is_active', true);
  res.json({ data: rows.map((r) => ({ ...r, prices: Object.fromEntries(prices.filter((p) => p.product_id === r.id).map((p) => [p.tier, { price: p.price, minOrderQty: p.min_order_qty, discountPercent: Number(p.discount_percent) }])) })), page, limit, total });
}));
router.get('/products/:id', requirePerm('products.read'), ah(async (req, res) => {
  const p = await db('products').where({ id: req.params.id }).first();
  if (!p) throw notFound('Product');
  p.images = await db('product_images').where({ product_id: p.id }).orderBy('sort_order');
  p.prices = await db('product_prices as pp').leftJoin('delivery_zones as z', 'z.id', 'pp.zone_id').leftJoin('users as u', 'u.id', 'pp.user_id').where('pp.product_id', p.id).select('pp.*', 'z.name as zone_name', 'u.name as user_name').orderBy(['tier', 'id']);
  p.quantityDiscounts = await db('quantity_discounts').where({ product_id: p.id }).orderBy(['tier', 'min_qty']);
  p.inventory = await db('inventory').where({ product_id: p.id }).first();
  res.json(p);
}));

const productRow = (b) => ({
  category_id: b.categoryId, name: b.name, sku: b.sku, description: b.description || null, size_ml: b.sizeMl, unit_type: b.unitType, units_per_pack: b.unitsPerPack,
  mrp: b.mrp, gst_percent: b.gstPercent, hsn_code: b.hsnCode || null, packaging_info: b.packagingInfo || null, is_returnable_jar: b.isReturnableJar, status: b.status, is_featured: b.isFeatured,
});
async function upsertBasePrices(trx, productId, prices = []) {
  for (const p of prices) {
    const row = { price: p.price, min_order_qty: p.minOrderQty, discount_percent: p.discountPercent, is_active: true, updated_at: trx.fn.now() };
    const ex = await trx('product_prices').where({ product_id: productId, tier: p.tier }).whereNull('user_id').whereNull('zone_id').first();
    if (ex) await trx('product_prices').where({ id: ex.id }).update(row);
    else await trx('product_prices').insert({ ...row, product_id: productId, tier: p.tier });
  }
  // The list is the full set of base prices: tiers left out stop being sold that product.
  await trx('product_prices').where({ product_id: productId }).whereNull('user_id').whereNull('zone_id')
    .whereNotIn('tier', prices.map((p) => p.tier)).update({ is_active: false, updated_at: trx.fn.now() });
}
router.post('/products', requirePerm('products.write'), validate({ body: v.product }), pricingGuard, ah(async (req, res) => {
  if (req.body.prices?.some((p) => p.price > req.body.mrp)) throw bad('A selling price cannot exceed MRP');
  const id = await db.transaction(async (trx) => {
    const [pid] = await trx('products').insert({ ...productRow(req.body), slug: `${slugify(req.body.name)}-${slugify(req.body.sku)}` });
    await trx('inventory').insert({ product_id: pid, low_stock_threshold: req.body.lowStockThreshold ?? 50 });
    await upsertBasePrices(trx, pid, req.body.prices);
    await audit.log(req, 'product.create', 'product', pid, { sku: req.body.sku }, trx);
    return pid;
  });
  res.status(201).json(await db('products').where({ id }).first());
}));
router.put('/products/:id', requirePerm('products.write'), validate({ body: v.product }), pricingGuard, ah(async (req, res) => {
  if (req.body.prices?.some((p) => p.price > req.body.mrp)) throw bad('A selling price cannot exceed MRP');
  await db.transaction(async (trx) => {
    const n = await trx('products').where({ id: req.params.id }).update({ ...productRow(req.body), updated_at: trx.fn.now() });
    if (!n) throw notFound('Product');
    if (req.body.lowStockThreshold !== undefined) await trx('inventory').where({ product_id: req.params.id }).update({ low_stock_threshold: req.body.lowStockThreshold });
    if (req.body.prices) await upsertBasePrices(trx, Number(req.params.id), req.body.prices);
    await audit.log(req, 'product.update', 'product', req.params.id, req.body, trx);
  });
  res.json(await db('products').where({ id: req.params.id }).first());
}));
router.delete('/products/:id', requirePerm('products.write'), ah(async (req, res) => {
  // Products with order history are archived, never deleted.
  if (await db('order_items').where({ product_id: req.params.id }).first()) {
    await db('products').where({ id: req.params.id }).update({ status: 'inactive' });
    await audit.log(req, 'product.archive', 'product', req.params.id);
    return res.json({ ok: true, archived: true });
  }
  await db('products').where({ id: req.params.id }).del();
  await audit.log(req, 'product.delete', 'product', req.params.id);
  res.json({ ok: true });
}));
router.post('/products/:id/images', requirePerm('products.write'), productUpload.array('images', 5), verifyMagic, ah(async (req, res) => {
  const p = await db('products').where({ id: req.params.id }).first();
  if (!p) throw notFound('Product');
  if (!req.files?.length) throw bad('Choose at least one image');
  const paths = req.files.map((f) => publicPath(f, 'products'));
  const max = (await db('product_images').where({ product_id: p.id }).max({ m: 'sort_order' }).first()).m ?? -1;
  await db('product_images').insert(paths.map((path, i) => ({ product_id: p.id, path, sort_order: max + 1 + i })));
  if (!p.image) await db('products').where({ id: p.id }).update({ image: paths[0] });
  res.status(201).json(await db('product_images').where({ product_id: p.id }).orderBy('sort_order'));
}));
router.post('/products/:id/images/:imageId/primary', requirePerm('products.write'), ah(async (req, res) => {
  const img = await db('product_images').where({ id: req.params.imageId, product_id: req.params.id }).first();
  if (!img) throw notFound('Image');
  await db('products').where({ id: req.params.id }).update({ image: img.path });
  res.json({ ok: true });
}));
router.delete('/products/:id/images/:imageId', requirePerm('products.write'), ah(async (req, res) => {
  await db('product_images').where({ id: req.params.imageId, product_id: req.params.id }).del();
  res.json({ ok: true });
}));

// ---------- Pricing: zone & negotiated overrides, quantity breaks ----------
router.post('/prices', requirePerm('pricing.write'), validate({ body: v.price }), ah(async (req, res) => {
  const b = req.body;
  const p = await db('products').where({ id: b.productId }).first();
  if (!p) throw notFound('Product');
  if (b.price > p.mrp) throw bad('Price cannot exceed MRP');
  if (b.userId) {
    const u = await db('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', b.userId).first('r.name as role');
    if (!u || u.role !== b.tier) throw bad('Negotiated price tier must match the buyer account type');
  }
  const [id] = await db('product_prices').insert({ product_id: b.productId, tier: b.tier, price: b.price, min_order_qty: b.minOrderQty, discount_percent: b.discountPercent, zone_id: b.zoneId || null, user_id: b.userId || null, valid_from: b.validFrom || null, valid_to: b.validTo || null, is_active: b.isActive });
  await audit.log(req, 'price.create', 'product_price', id, b);
  res.status(201).json(await db('product_prices').where({ id }).first());
}));
router.put('/prices/:id', requirePerm('pricing.write'), validate({ body: v.price }), ah(async (req, res) => {
  const b = req.body;
  await db('product_prices').where({ id: req.params.id }).update({ price: b.price, min_order_qty: b.minOrderQty, discount_percent: b.discountPercent, valid_from: b.validFrom || null, valid_to: b.validTo || null, is_active: b.isActive, updated_at: db.fn.now() });
  await audit.log(req, 'price.update', 'product_price', req.params.id, b);
  res.json(await db('product_prices').where({ id: req.params.id }).first());
}));
router.delete('/prices/:id', requirePerm('pricing.write'), ah(async (req, res) => {
  const row = await db('product_prices').where({ id: req.params.id }).first();
  if (!row) throw notFound('Price');
  if (!row.user_id && !row.zone_id) throw bad('Base tier prices cannot be deleted; set them inactive instead');
  await db('product_prices').where({ id: row.id }).del();
  await audit.log(req, 'price.delete', 'product_price', row.id);
  res.json({ ok: true });
}));
router.put('/products/:id/quantity-discounts', requirePerm('pricing.write'), validate({ body: v.z.object({ breaks: v.z.array(v.z.object({ tier: v.tier, minQty: v.z.coerce.number().int().min(2), discountPercent: v.z.coerce.number().min(0.01).max(90) })) }) }), ah(async (req, res) => {
  await db.transaction(async (trx) => {
    await trx('quantity_discounts').where({ product_id: req.params.id }).del();
    if (req.body.breaks.length) await trx('quantity_discounts').insert(req.body.breaks.map((b) => ({ product_id: Number(req.params.id), tier: b.tier, min_qty: b.minQty, discount_percent: b.discountPercent })));
    await audit.log(req, 'price.qty_breaks', 'product', req.params.id, req.body, trx);
  });
  res.json(await db('quantity_discounts').where({ product_id: req.params.id }).orderBy(['tier', 'min_qty']));
}));

// ---------- Inventory & batches ----------
router.get('/inventory', requirePerm('inventory.read'), ah(async (req, res) => res.json(await db('inventory as i').join('products as p', 'p.id', 'i.product_id')
  .select('i.*', 'p.name', 'p.sku', 'p.status', 'p.image', db.raw('i.quantity_available <= i.low_stock_threshold as is_low'),
    db.raw("(SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.product_id = p.id AND b.status='active' AND b.quantity_remaining > 0) as next_expiry"),
    db.raw("(SELECT COUNT(*) FROM inventory_batches b WHERE b.product_id = p.id AND b.status='active') as active_batches"))
  .orderBy('p.name'))));
router.patch('/inventory/:productId', requirePerm('inventory.write'), validate({ body: v.z.object({ lowStockThreshold: v.z.coerce.number().int().min(0) }) }), ah(async (req, res) => {
  await db('inventory').where({ product_id: req.params.productId }).update({ low_stock_threshold: req.body.lowStockThreshold });
  res.json({ ok: true });
}));
router.get('/batches', requirePerm('inventory.read'), ah(async (req, res) => {
  const q = db('inventory_batches as b').join('products as p', 'p.id', 'b.product_id').leftJoin('users as u', 'u.id', 'b.created_by');
  if (req.query.productId) q.where('b.product_id', Number(req.query.productId));
  if (req.query.status) q.andWhere('b.status', String(req.query.status));
  res.json(await q.select('b.*', 'p.name as product_name', 'p.sku', 'u.name as created_by_name').orderBy('b.id', 'desc').limit(500));
}));
router.post('/batches', requirePerm('inventory.write'), validate({ body: v.z.object({ productId: v.id, batchNumber: v.z.string().trim().toUpperCase().min(3).max(60), manufacturingDate: v.isoDate, expiryDate: v.isoDate, quantity: v.z.coerce.number().int().positive(), notes: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  const id = await db.transaction(async (trx) => {
    const bid = await inventory.addBatch(trx, req.body, req.user.id);
    await audit.log(req, 'batch.create', 'batch', bid, req.body, trx);
    return bid;
  });
  res.status(201).json(await db('inventory_batches').where({ id }).first());
}));
router.patch('/batches/:id', requirePerm('inventory.write'), validate({ body: v.z.object({ status: v.z.enum(['active', 'quarantined']), notes: v.opt(v.z.string().max(300)) }) }), ah(async (req, res) => {
  const b = await db('inventory_batches').where({ id: req.params.id }).first();
  if (!b) throw notFound('Batch');
  if (!['active', 'quarantined'].includes(b.status)) throw bad(`A ${b.status} batch cannot be changed`);
  if (b.status !== req.body.status) {
    // Quarantine removes the batch's remaining units from sellable stock; release puts them back.
    await db.transaction(async (trx) => {
      const delta = req.body.status === 'quarantined' ? -b.quantity_remaining : b.quantity_remaining;
      const inv = await trx('inventory').where({ product_id: b.product_id }).first();
      if (delta < 0 && inv.quantity_available < -delta) throw bad('Some units of this batch are reserved for orders; quarantine after they ship or cancel them');
      await trx('inventory').where({ product_id: b.product_id }).increment('quantity_available', delta);
      await trx('inventory_batches').where({ id: b.id }).update({ status: req.body.status, notes: req.body.notes ?? b.notes });
      await trx('stock_movements').insert({ product_id: b.product_id, batch_id: b.id, type: 'adjustment', quantity: delta, note: `Batch ${req.body.status}`, created_by: req.user.id });
      await audit.log(req, `batch.${req.body.status}`, 'batch', b.id, null, trx);
    });
  }
  res.json(await db('inventory_batches').where({ id: b.id }).first());
}));
router.post('/inventory/adjust', requirePerm('inventory.write'), validate({ body: v.z.object({ productId: v.id, batchId: v.id, quantity: v.z.coerce.number().int().refine((x) => x !== 0, 'Cannot be zero'), type: v.z.enum(['adjustment', 'damage']).default('adjustment'), reason: v.z.string().trim().min(3).max(300) }) }), ah(async (req, res) => {
  if (req.body.type === 'damage' && req.body.quantity > 0) throw bad('Damage must be a negative quantity');
  await db.transaction(async (trx) => {
    await inventory.adjust(trx, req.body, req.user.id);
    await inventory.checkLowStock(trx, [req.body.productId]);
    await audit.log(req, `stock.${req.body.type}`, 'product', req.body.productId, req.body, trx);
  });
  res.json(await db('inventory').where({ product_id: req.body.productId }).first());
}));
router.get('/stock-movements', requirePerm('inventory.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('stock_movements as m').leftJoin('products as p', 'p.id', 'm.product_id').leftJoin('packaging_materials as pm', 'pm.id', 'm.material_id').leftJoin('inventory_batches as b', 'b.id', 'm.batch_id').leftJoin('users as u', 'u.id', 'm.created_by');
  if (req.query.productId) q.where('m.product_id', Number(req.query.productId));
  if (req.query.type) q.andWhere('m.type', String(req.query.type));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  res.json({ data: await q.select('m.*', 'p.name as product_name', 'pm.name as material_name', 'b.batch_number', 'u.name as user_name').orderBy('m.id', 'desc').limit(limit).offset(offset), page, limit, total });
}));

// Packaging & raw materials (preforms, caps, labels, empty jars)
router.get('/materials', requirePerm('inventory.read'), ah(async (req, res) => res.json(await db('packaging_materials').orderBy('name'))));
router.post('/materials', requirePerm('inventory.write'), validate({ body: v.z.object({ name: v.z.string().trim().min(2).max(120), unit: v.z.string().max(20).default('pcs'), quantity: v.z.coerce.number().int().min(0).default(0), lowStockThreshold: v.z.coerce.number().int().min(0).default(0) }) }), ah(async (req, res) => {
  const [id] = await db('packaging_materials').insert({ name: req.body.name, unit: req.body.unit, quantity: req.body.quantity, low_stock_threshold: req.body.lowStockThreshold });
  res.status(201).json(await db('packaging_materials').where({ id }).first());
}));
router.post('/materials/:id/adjust', requirePerm('inventory.write'), validate({ body: v.z.object({ quantity: v.z.coerce.number().int().refine((x) => x !== 0), note: v.z.string().trim().min(2).max(300), lowStockThreshold: v.z.coerce.number().int().min(0).optional() }) }), ah(async (req, res) => {
  await db.transaction(async (trx) => {
    const m = await trx('packaging_materials').where({ id: req.params.id }).first();
    if (!m) throw notFound('Material');
    if (m.quantity + req.body.quantity < 0) throw bad(`Only ${m.quantity} ${m.unit} in stock`);
    await trx('packaging_materials').where({ id: m.id }).update({ quantity: m.quantity + req.body.quantity, ...(req.body.lowStockThreshold !== undefined && { low_stock_threshold: req.body.lowStockThreshold }), updated_at: trx.fn.now() });
    await trx('stock_movements').insert({ material_id: m.id, type: req.body.quantity > 0 ? 'material_in' : 'material_out', quantity: req.body.quantity, note: req.body.note, created_by: req.user.id });
    await audit.log(req, 'material.adjust', 'material', m.id, req.body, trx);
  });
  res.json(await db('packaging_materials').where({ id: req.params.id }).first());
}));

module.exports = router;
