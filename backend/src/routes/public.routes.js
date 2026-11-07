/** Storefront endpoints. Prices are resolved for the caller's tier only (guests = customer tier). */
const router = require('express').Router();
const db = require('../database/db');
const settings = require('../services/settings.service');
const pricing = require('../services/pricing.service');
const { optionalAuth } = require('../middleware/auth');
const { validate } = require('../middleware/common');
const { ah, notFound, bad } = require('../utils/errors');
const { parseJSON, paginate } = require('../utils/helpers');
const v = require('../validators');

const buyerOf = (req) => ({ tier: req.user?.tier || 'customer', userId: req.user?.tier ? req.user.id : null, zoneId: req.query.zoneId ? Number(req.query.zoneId) : null });

const PUBLIC_COLS = ['p.id', 'p.category_id', 'p.name', 'p.slug', 'p.sku', 'p.description', 'p.size_ml', 'p.unit_type', 'p.units_per_pack', 'p.mrp',
  'p.gst_percent', 'p.packaging_info', 'p.is_returnable_jar', 'p.status', 'p.is_featured', 'p.image', 'c.name as category_name', 'c.slug as category_slug'];

router.get('/settings', ah(async (req, res) => res.json(await settings.getPublic())));

router.get('/categories', ah(async (req, res) => {
  const rows = await db('categories as c').where('c.is_active', true)
    .select('c.*', db.raw("(SELECT COUNT(*) FROM products p WHERE p.category_id = c.id AND p.status != 'inactive') as product_count"))
    .orderBy('c.sort_order');
  res.json(rows);
}));

router.get('/products', optionalAuth, ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('products as p').join('categories as c', 'c.id', 'p.category_id').whereNot('p.status', 'inactive').andWhere('c.is_active', true);
  if (req.query.category) q.andWhere('c.slug', String(req.query.category));
  if (req.query.search) {
    const s = `%${String(req.query.search).trim().toLowerCase()}%`;
    q.andWhere((w) => w.whereRaw('LOWER(p.name) LIKE ?', [s]).orWhereRaw('LOWER(p.description) LIKE ?', [s]).orWhereRaw('LOWER(p.sku) LIKE ?', [s]));
  }
  if (req.query.featured === 'true') q.andWhere('p.is_featured', true);
  if (req.query.type) q.andWhere('p.unit_type', String(req.query.type));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  const sort = { name: ['p.name', 'asc'], size: ['p.size_ml', 'asc'], newest: ['p.id', 'desc'] }[req.query.sort] || ['p.size_ml', 'asc'];
  const rows = await q.select(PUBLIC_COLS).orderBy(...sort).limit(limit).offset(offset);
  let priced = await pricing.priceCatalog(rows, buyerOf(req));
  const ratings = await db('reviews').where('status', 'approved').whereIn('product_id', rows.map((r) => r.id)).select('product_id').avg({ avg: 'rating' }).count({ n: '*' }).groupBy('product_id');
  const rmap = new Map(ratings.map((r) => [r.product_id, r]));
  const stock = new Map((await db('inventory').whereIn('product_id', rows.map((r) => r.id))).map((i) => [i.product_id, i.quantity_available]));
  priced = priced.map((p) => ({ ...p, rating: rmap.get(p.id) ? { avg: Number(rmap.get(p.id).avg.toFixed(1)), count: rmap.get(p.id).n } : null, inStock: (stock.get(p.id) || 0) > 0 }));
  if (req.query.sort === 'price') priced.sort((a, b) => (a.price?.unitPrice ?? Infinity) - (b.price?.unitPrice ?? Infinity));
  res.json({ data: priced, page, limit, total, tier: buyerOf(req).tier });
}));

router.get('/products/:slug', optionalAuth, ah(async (req, res) => {
  const p = await db('products as p').join('categories as c', 'c.id', 'p.category_id').where('p.slug', req.params.slug).whereNot('p.status', 'inactive').first(PUBLIC_COLS);
  if (!p) throw notFound('Product');
  const [priced] = await pricing.priceCatalog([p], buyerOf(req));
  priced.images = await db('product_images').where({ product_id: p.id }).orderBy('sort_order').pluck('path');
  const inv = await db('inventory').where({ product_id: p.id }).first('quantity_available');
  priced.inStock = (inv?.quantity_available || 0) > 0;
  priced.stockLeft = inv && inv.quantity_available < 20 ? inv.quantity_available : null;
  priced.reviews = await db('reviews as r').join('users as u', 'u.id', 'r.user_id').where({ 'r.product_id': p.id, 'r.status': 'approved' })
    .orderBy('r.id', 'desc').limit(20).select('r.id', 'r.rating', 'r.comment', 'r.created_at', 'u.name');
  priced.related = await pricing.priceCatalog(await db('products as p').join('categories as c', 'c.id', 'p.category_id').where('p.status', 'active').whereNot('p.id', p.id).limit(4).select(PUBLIC_COLS), buyerOf(req));
  res.json(priced);
}));

router.get('/cms', ah(async (req, res) => {
  const q = db('cms_content').where('is_active', true).orderBy('sort_order');
  if (req.query.type) q.andWhere('type', String(req.query.type));
  res.json((await q).map((r) => ({ ...r, body: parseJSON(r.body, r.body) })));
}));
router.get('/cms/page/:slug', ah(async (req, res) => {
  const r = await db('cms_content').where({ type: 'page', slug: req.params.slug, is_active: true }).first();
  if (!r) throw notFound('Page');
  res.json({ ...r, body: parseJSON(r.body, r.body) });
}));

router.get('/testimonials', ah(async (req, res) => {
  const rows = await db('reviews as r').join('users as u', 'u.id', 'r.user_id').join('products as p', 'p.id', 'r.product_id')
    .where('r.status', 'approved').andWhere('r.rating', '>=', 4).orderBy('r.id', 'desc').limit(6).select('r.rating', 'r.comment', 'u.name', 'p.name as product');
  res.json(rows);
}));

router.get('/delivery/check/:pincode', ah(async (req, res) => {
  const pin = v.pincode.parse(req.params.pincode);
  const zones = await db('delivery_zones').where('is_active', true);
  const z = zones.find((x) => parseJSON(x.pincodes, []).includes(pin));
  res.json(z ? { serviceable: true, zone: { id: z.id, name: z.name, deliveryCharge: z.delivery_charge, freeDeliveryAbove: z.free_delivery_above, minOrderValue: z.min_order_value } } : { serviceable: false });
}));
router.get('/delivery/zones', ah(async (req, res) => res.json((await db('delivery_zones').where('is_active', true).select('id', 'name', 'pincodes')).map((z) => ({ ...z, pincodes: parseJSON(z.pincodes, []) })))));

router.post('/enquiries', validate({ body: v.z.object({
  type: v.z.enum(['contact', 'bulk', 'partnership']), name: v.z.string().trim().min(2).max(120), phone: v.phone, email: v.opt(v.email),
  businessName: v.opt(v.z.string().max(160)), message: v.opt(v.z.string().max(2000)), details: v.z.record(v.z.string(), v.z.any()).optional(),
}) }), ah(async (req, res) => {
  const [id] = await db('enquiries').insert({ type: req.body.type, name: req.body.name, phone: req.body.phone, email: req.body.email || null, business_name: req.body.businessName || null, message: req.body.message || null, details: req.body.details ? JSON.stringify(req.body.details) : null });
  await db.transaction((trx) => require('../services/notification.service').toRole(trx, 'super_admin', { type: 'enquiry', title: `New ${req.body.type} enquiry`, body: `${req.body.name} · ${req.body.phone}` }));
  res.status(201).json({ id, message: 'Thank you! Our team will contact you shortly.' });
}));

router.get('/track/:orderNumber', ah(async (req, res) => {
  // Public tracking needs order number + the phone on the order, so numbers alone reveal nothing.
  const phone = v.phone.safeParse(req.query.phone);
  if (!phone.success) throw bad('Enter the mobile number used for the order');
  const o = await db('orders as o').join('users as u', 'u.id', 'o.user_id').where('o.order_number', req.params.orderNumber).andWhere('u.phone', phone.data)
    .first('o.id', 'o.order_number', 'o.status', 'o.created_at', 'o.delivery_date', 'o.delivery_slot', 'o.grand_total', 'o.payment_status');
  if (!o) throw notFound('Order');
  o.timeline = await db('order_status_history').where({ order_id: o.id }).orderBy('id').select('to_status', 'note', 'created_at');
  delete o.id;
  res.json(o);
}));

module.exports = router;
