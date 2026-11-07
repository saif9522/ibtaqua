/**
 * DEMO DATA — development only. Everything created here is fictional sample data.
 * Prices, GST rates and pincodes are placeholders to exercise the system; set real values in Admin.
 * Orders are created through the real services, so stock, invoices, jars and payments stay consistent.
 */
const bcrypt = require('bcryptjs');
const db = require('./db');
const settings = require('../services/settings.service');
const inventory = require('../services/inventory.service');
const orders = require('../services/order.service');
const payments = require('../services/payment.service');
const subs = require('../services/subscription.service');
const { tierForRole } = require('../config/rbac');
const { todayIST, addDays, sqlTime } = require('../utils/helpers');

const R = (rupees) => Math.round(rupees * 100);
let seed = 42;
const rand = () => { seed = (seed * 16807) % 2147483647; return seed / 2147483647; };
const pick = (a) => a[Math.floor(rand() * a.length)];

async function user(role, { name, phone, email, password, business, delivery }) {
  const r = await db('roles').where({ name: role }).first();
  const [id] = await db('users').insert({ role_id: r.id, name, phone, email: email || null, password_hash: password ? await bcrypt.hash(password, 10) : null, status: business?.pending ? 'pending' : 'active' });
  if (role === 'customer') await db('customers').insert({ user_id: id });
  if (business) {
    const { pending, ...b } = business;
    await db(`${role}s`).insert({ user_id: id, contact_person: name, approval_status: pending ? 'pending' : 'approved', approved_at: pending ? null : db.fn.now(), ...b });
  }
  if (delivery) await db('delivery_staff').insert({ user_id: id, ...delivery });
  return id;
}

async function address(userId, zoneId, a) {
  const [id] = await db('user_addresses').insert({ user_id: userId, zone_id: zoneId, is_default: true, state: 'Jharkhand', city: 'Medininagar', ...a });
  return id;
}

async function load() {
  // ---- Settings tuned for the demo ----
  await settings.set('business_profile', {
    ...(await settings.get('business_profile')),
    address: 'Plant address — set in Admin → Settings', pincode: '822101', phone: '9000000000', whatsapp: '9000000000', email: 'hello@example.com', sales_phone: '9000000000',
    gstin: '20AAAAA0000A1Z5', fssai: 'DEMO-FSSAI', bis_license: 'DEMO-BIS', plant_location: { lat: 24.0336, lng: 84.0681 },
  });
  await settings.set('bank_details', { account_name: 'IBT ENTERPRISES (demo)', bank: 'Demo Bank', account_number: '000000000000', ifsc: 'DEMO0000000', upi_id: 'ibtaqua@demo' });
  await settings.set('jar_deposit_amount', R(150));
  await settings.set('min_order_value_by_tier', { customer: 0, retailer: R(500), wholesaler: R(3000), distributor: R(10000) });
  await settings.set('unit_costs', { 'IBT-500-1': R(3.5), 'IBT-500-C24': R(80), 'IBT-1L-1': R(6), 'IBT-1L-C12': R(70), 'IBT-2L-C9': R(110), 'IBT-12L-JAR': R(18), 'IBT-20L-JAR': R(22), 'IBT-BULK-1KL': R(350), 'IBT-PL-500-C24': R(95) });

  // ---- Zones (demo pincodes — verify before going live) ----
  const [zCity] = await db('delivery_zones').insert({ name: 'Medininagar City', pincodes: JSON.stringify(['822101', '822102']), delivery_charge: R(20), free_delivery_above: R(300), min_order_value: R(50) });
  const [zRural] = await db('delivery_zones').insert({ name: 'Palamu Rural', pincodes: JSON.stringify(['822110', '822111', '822113', '822115', '822116', '822118', '822119', '822120']), delivery_charge: R(50), free_delivery_above: R(800), min_order_value: R(200) });

  // ---- Users ----
  const ids = {};
  ids.super = await user('super_admin', { name: 'IBT Super Admin', phone: '9000000001', email: 'admin@ibtaqua.test', password: 'Admin@123' });
  ids.admin = await user('admin', { name: 'Operations Manager', phone: '9000000002', email: 'ops@ibtaqua.test', password: 'Admin@123' });
  ids.d1 = await user('delivery', { name: 'Ravi Kumar', phone: '9000000011', password: 'Delivery@123', delivery: { vehicle_number: 'JH03AB1234', zone_id: zCity } });
  ids.d2 = await user('delivery', { name: 'Sunil Oraon', phone: '9000000012', password: 'Delivery@123', delivery: { vehicle_number: 'JH03CD5678', zone_id: zRural } });
  ids.c1 = await user('customer', { name: 'Priya Sharma', phone: '9000000101', email: 'priya@example.com' });
  ids.c2 = await user('customer', { name: 'Amit Verma', phone: '9000000102' });
  ids.c3 = await user('customer', { name: 'Hotel Palamu Residency', phone: '9000000103' });
  ids.r1 = await user('retailer', { name: 'Rakesh Sharma', phone: '9000000201', email: 'retailer@example.com', password: 'Retail@123', business: { business_name: 'Sharma General Store', gstin: '20ABCDE1234F1Z5', business_address: 'Main Road', city: 'Medininagar', state: 'Jharkhand', pincode: '822101', credit_enabled: true, credit_limit: R(20000), credit_days: 15 } });
  ids.r2 = await user('retailer', { name: 'Neha Gupta', phone: '9000000202', password: 'Retail@123', business: { business_name: 'Gupta Kirana (pending approval)', gstin: '20FGHIJ5678K1Z2', business_address: 'Station Road', city: 'Medininagar', state: 'Jharkhand', pincode: '822102', pending: true } });
  ids.w1 = await user('wholesaler', { name: 'Manoj Singh', phone: '9000000301', email: 'wholesale@example.com', password: 'Whole@123', business: { business_name: 'Palamu Beverages Wholesale', gstin: '20KLMNO9012P1Z8', business_address: 'Bazaar Samiti', city: 'Medininagar', state: 'Jharkhand', pincode: '822101', credit_enabled: true, credit_limit: R(150000), credit_days: 30 } });
  ids.dist = await user('distributor', { name: 'Arvind Prasad', phone: '9000000401', email: 'distributor@example.com', password: 'Dist@123', business: { business_name: 'Palamu Aqua Distributors', gstin: '20QRSTU3456V1Z1', business_address: 'Industrial Area', city: 'Medininagar', state: 'Jharkhand', pincode: '822101', credit_enabled: true, credit_limit: R(500000), credit_days: 30, agreement_ref: 'DA-2026-001', agreement_valid_to: addDays(todayIST(), 365) } });
  await db('distributor_zones').insert([{ user_id: ids.dist, zone_id: zRural }]);

  const addr = {};
  addr.c1 = await address(ids.c1, zCity, { label: 'Home', contact_name: 'Priya Sharma', contact_phone: '9000000101', line1: 'House 12, Bairiya Chowk', pincode: '822101', lat: 24.0412, lng: 84.0725 });
  addr.c2 = await address(ids.c2, zCity, { label: 'Home', contact_name: 'Amit Verma', contact_phone: '9000000102', line1: 'Near Shahpur Bridge', pincode: '822102', lat: 24.0291, lng: 84.0598 });
  addr.c3 = await address(ids.c3, zCity, { label: 'Hotel', contact_name: 'Front Desk', contact_phone: '9000000103', line1: 'Kachahari Road', pincode: '822101', lat: 24.0367, lng: 84.0702 });
  addr.r1 = await address(ids.r1, zCity, { label: 'Shop', contact_name: 'Rakesh Sharma', contact_phone: '9000000201', line1: 'Sharma General Store, Main Road', pincode: '822101', lat: 24.0351, lng: 84.0663 });
  addr.w1 = await address(ids.w1, zCity, { label: 'Godown', contact_name: 'Manoj Singh', contact_phone: '9000000301', line1: 'Bazaar Samiti Godown 4', pincode: '822101', lat: 24.0303, lng: 84.0751 });
  addr.dist = await address(ids.dist, zRural, { label: 'Depot', contact_name: 'Arvind Prasad', contact_phone: '9000000401', line1: 'Depot, Chainpur Road', city: 'Chainpur', pincode: '822110' });

  // ---- Products: [sku, category slug, name, size_ml, unit, units/pack, mrp, gst, jar?, featured, {customer, retailer, wholesaler, distributor}, MOQs] ----
  const cats = Object.fromEntries((await db('categories')).map((c) => [c.slug, c.id]));
  const P = [
    ['IBT-500-1', '500ml', 'IBT AQUA 500 ml Bottle', 500, 'bottle', 1, 10, 18, false, false, { customer: 10, retailer: 7, wholesaler: 6, distributor: 5.5 }, { retailer: 24, wholesaler: 96, distributor: 240 }],
    ['IBT-500-C24', '500ml', 'IBT AQUA 500 ml — Case of 24', 500, 'case', 24, 240, 18, false, true, { customer: 200, retailer: 160, wholesaler: 140, distributor: 128 }, { retailer: 2, wholesaler: 10, distributor: 25 }],
    ['IBT-1L-1', '1-litre', 'IBT AQUA 1 Litre Bottle', 1000, 'bottle', 1, 20, 18, false, false, { customer: 20, retailer: 15, wholesaler: 12, distributor: 11 }, { retailer: 12, wholesaler: 60, distributor: 120 }],
    ['IBT-1L-C12', '1-litre', 'IBT AQUA 1 Litre — Case of 12', 1000, 'case', 12, 240, 18, false, true, { customer: 220, retailer: 170, wholesaler: 140, distributor: 130 }, { retailer: 2, wholesaler: 10, distributor: 25 }],
    ['IBT-2L-C9', '2-litre', 'IBT AQUA 2 Litre — Case of 9', 2000, 'case', 9, 315, 18, false, true, { customer: 290, retailer: 240, wholesaler: 215, distributor: 200 }, { retailer: 2, wholesaler: 8, distributor: 20 }],
    ['IBT-12L-JAR', '12-litre-jar', 'IBT AQUA 12 Litre Jar', 12000, 'jar', 1, 60, 5, false, false, { customer: 50, retailer: 40, wholesaler: 35, distributor: 32 }, { retailer: 5, wholesaler: 20, distributor: 50 }],
    ['IBT-20L-JAR', '20-litre-jar', 'IBT AQUA 20 Litre Jar (Refill)', 20000, 'jar', 1, 80, 5, true, true, { customer: 60, retailer: 45, wholesaler: 40, distributor: 35 }, { retailer: 5, wholesaler: 20, distributor: 50 }],
    ['IBT-BULK-1KL', 'bulk-supply', 'Bulk Water Supply — 1,000 Litres', 1000000, 'bulk', 1, 1200, 5, false, false, { customer: 1000, retailer: 900, wholesaler: 850, distributor: 800 }, {}],
    ['IBT-PL-500-C24', 'custom-business', 'Private Label 500 ml — Case of 24 (your brand label)', 500, 'case', 24, 288, 18, false, false, { wholesaler: 170, distributor: 155 }, { wholesaler: 50, distributor: 100 }],
  ];
  const prod = {};
  for (const [sku, cat, name, size, unit, per, mrp, gst, jar, featured, prices, moq] of P) {
    const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/(^-|-$)/g, '');
    const [pid] = await db('products').insert({
      category_id: cats[cat], name, slug, sku, size_ml: size, unit_type: unit, units_per_pack: per, mrp: R(mrp), gst_percent: gst, hsn_code: '2201', is_returnable_jar: jar, is_featured: featured,
      // Real photo where we have one (IBT AQUA 2 L bottle); illustrations elsewhere until photos are uploaded.
      image: sku === 'IBT-2L-C9' ? '/brand/bottle-2l.webp' : `/brand/products/${sku.toLowerCase()}.svg`,
      description: `${name}. Purified through multi-stage RO, UV and ozonation, sealed in food-grade packaging at our Palamu plant.${jar ? ' Refill price — exchange your empty jar at delivery. A refundable deposit applies to new jars.' : ''}`,
      packaging_info: unit === 'case' ? `${per} bottles per shrink-wrapped case` : unit === 'jar' ? 'Food-grade PET/PC jar with tamper-proof seal' : unit === 'bulk' ? 'Delivered by tanker; schedule with our team' : 'Single PET bottle',
    });
    prod[sku] = pid;
    await db('inventory').insert({ product_id: pid, low_stock_threshold: unit === 'bulk' ? 2 : 40 });
    for (const [tier, price] of Object.entries(prices)) await db('product_prices').insert({ product_id: pid, tier, price: R(price), min_order_qty: moq[tier] || 1 });
  }
  await db('quantity_discounts').insert([
    { product_id: prod['IBT-1L-C12'], tier: 'customer', min_qty: 5, discount_percent: 3 },
    { product_id: prod['IBT-20L-JAR'], tier: 'customer', min_qty: 4, discount_percent: 5 },
    { product_id: prod['IBT-1L-C12'], tier: 'retailer', min_qty: 20, discount_percent: 2 },
    { product_id: prod['IBT-1L-C12'], tier: 'wholesaler', min_qty: 50, discount_percent: 3 },
  ]);
  // Negotiated price agreement for the distributor + a rural zone price for customers.
  await db('product_prices').insert({ product_id: prod['IBT-1L-C12'], tier: 'distributor', user_id: ids.dist, price: R(125), min_order_qty: 25, valid_to: addDays(todayIST(), 180) });
  await db('product_prices').insert({ product_id: prod['IBT-20L-JAR'], tier: 'customer', zone_id: zRural, price: R(65), min_order_qty: 1 });

  // ---- Production batches ----
  const today = todayIST();
  let n = 1;
  for (const [sku, pid] of Object.entries(prod)) {
    const qty = sku === 'IBT-BULK-1KL' ? 40 : sku.includes('-C') ? 900 : 2500;
    for (const ageDays of [75, 20]) {
      await db.transaction((trx) => inventory.addBatch(trx, { productId: pid, batchNumber: `B${today.replace(/-/g, '').slice(2, 6)}-${String(n++).padStart(3, '0')}`, manufacturingDate: addDays(today, -ageDays), expiryDate: addDays(today, 180 - ageDays), quantity: qty, notes: 'Demo batch' }, ids.super));
    }
  }
  await db('packaging_materials').update({ quantity: 5000, low_stock_threshold: 500 });
  await db('packaging_materials').where('name', 'Empty 20L Jars').update({ quantity: 350, low_stock_threshold: 100 });

  // ---- Coupons ----
  await db('coupons').insert([
    { code: 'WELCOME10', description: '10% off your first order (up to ₹50)', discount_type: 'percent', value: 10, max_discount: R(50), min_order_value: R(150), applicable_tiers: '["customer"]', per_user_limit: 1 },
    { code: 'JAR20', description: '₹20 off 20L jar orders above ₹240', discount_type: 'flat', value: R(20), min_order_value: R(240), applicable_tiers: '["customer"]', per_user_limit: 5 },
    { code: 'RETAIL5', description: '5% off retailer orders above ₹3,000', discount_type: 'percent', value: 5, max_discount: R(500), min_order_value: R(3000), applicable_tiers: '["retailer"]', per_user_limit: 3 },
    { code: 'BULK500', description: '₹500 off wholesale orders above ₹15,000', discount_type: 'flat', value: R(500), min_order_value: R(15000), applicable_tiers: '["wholesaler","distributor"]', per_user_limit: 2 },
  ]);

  // ---- CMS ----
  const cms = [
    ['banner', 'hero-1', 'Pure water, delivered to your door', { subtitle: 'Bottled at our Palamu plant through 7-stage purification. Order bottles and jars online.', cta: 'Shop water', ctaLink: '/shop' }, '/shop', '/brand/range.webp'],
    ['banner', 'hero-2', 'Partner with IBT AQUA', { subtitle: 'Special rates, monthly credit and scheduled supply for retailers, wholesalers and distributors.', cta: 'Become a partner', ctaLink: '/partners' }, '/partners', '/brand/bottle-2l.webp'],
    ['banner', 'hero-3', 'Jars for home and office', { subtitle: 'Daily or weekly jar deliveries. Hand over the empty, pay only for the refill.', cta: 'Start a subscription', ctaLink: '/account/subscriptions' }, '/account/subscriptions', '/brand/jar-5l.webp'],
    ['section', 'quality-process', 'Our water quality process', { steps: [
      { title: 'Source testing', text: 'Raw water is tested at intake for hardness, TDS and microbes.' },
      { title: 'Sand & carbon filtration', text: 'Removes sediment, chlorine, odour and organic matter.' },
      { title: 'Reverse osmosis', text: 'Membranes remove dissolved salts and heavy metals.' },
      { title: 'Mineral balancing', text: 'Essential minerals are restored for taste and health.' },
      { title: 'UV & ozonation', text: 'Disinfection that keeps water safe through its shelf life.' },
      { title: 'Lab-checked & sealed', text: 'Every batch is lab-tested and sealed with a batch number.' },
    ] }],
    ['section', 'why-choose', 'Why choose IBT AQUA', { items: [
      { title: 'Made in Palamu', text: 'Manufactured locally, so water reaches you fresh.' },
      { title: 'Batch traceability', text: 'Every bottle carries a batch number and expiry date.' },
      { title: 'On-time delivery', text: 'Pick a slot; track your order live until it arrives.' },
      { title: 'Fair jar deposits', text: 'Pay a deposit once; exchange empties at every refill.' },
    ] }],
  ];
  const faqs = [
    ['How do 20L jar refills work?', 'Your first order includes a refundable jar deposit. After that, hand over your empty jar at each delivery and pay only the refill price.'],
    ['Which areas do you deliver to?', 'We currently deliver across Medininagar and parts of Palamu. Enter your pincode on the shop page to check.'],
    ['Can I schedule regular deliveries?', 'Yes. Start a daily, alternate-day, weekly, monthly or custom-day subscription from any product page or your account.'],
    ['How do retailers and wholesalers get special prices?', 'Register as a partner and upload your GST certificate. Once approved, you see your partner prices automatically when logged in.'],
    ['What payment options are available?', 'UPI, cards and netbanking via Razorpay, Cash on Delivery, and for approved partners bank transfer and monthly credit.'],
    ['How do I get a GST invoice?', 'Invoices are generated when your order is dispatched. Download them from My Orders.'],
  ];
  for (const [i, [type, slug, title, body, link, image]] of cms.entries()) await db('cms_content').insert({ type, slug, title, body: JSON.stringify(body), link: link || null, image: image || null, sort_order: i });
  for (const [i, [q, a]] of faqs.entries()) await db('cms_content').insert({ type: 'faq', slug: `faq-${i + 1}`, title: q, body: JSON.stringify({ answer: a }), sort_order: i });
  await db('cms_content').where({ type: 'page', slug: 'about' }).update({ body: JSON.stringify({ markdown: '# About IBT AQUA\n\nIBT AQUA is the packaged drinking water brand of **IBT ENTERPRISES**, Palamu, Jharkhand. We purify, bottle and deliver water from our own plant to homes, shops, offices and partners across the region.\n\n_Replace this text with your story in Admin → Website CMS._' }) });

  // ---- Orders: realistic history through the real services ----
  const buyers = [
    { id: ids.c1, role: 'customer', addr: addr.c1, items: [['IBT-20L-JAR', 2, 3], ['IBT-1L-C12', 1, 2]], pay: ['razorpay', 'cod'] },
    { id: ids.c2, role: 'customer', addr: addr.c2, items: [['IBT-20L-JAR', 1, 2], ['IBT-500-C24', 1, 1]], pay: ['cod'] },
    { id: ids.c3, role: 'customer', addr: addr.c3, items: [['IBT-1L-C12', 4, 8], ['IBT-20L-JAR', 4, 8]], pay: ['razorpay', 'cod'] },
    { id: ids.r1, role: 'retailer', addr: addr.r1, items: [['IBT-1L-C12', 4, 10], ['IBT-500-C24', 2, 6], ['IBT-20L-JAR', 5, 10]], pay: ['credit', 'cod'] },
    { id: ids.w1, role: 'wholesaler', addr: addr.w1, items: [['IBT-1L-C12', 12, 30], ['IBT-500-C24', 10, 20], ['IBT-2L-C9', 8, 12]], pay: ['credit', 'bank_transfer'] },
    { id: ids.dist, role: 'distributor', addr: addr.dist, items: [['IBT-1L-C12', 50, 90], ['IBT-20L-JAR', 120, 220]], pay: ['credit'] },
  ];
  const staff = Object.fromEntries((await db('delivery_staff')).map((s) => [s.user_id, s.id]));
  const flow = ['confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'out_for_delivery', 'delivered'];
  const actor = { id: ids.admin };
  for (let day = 58; day >= 0; day--) {
    const count = day === 0 ? 4 : 1 + Math.floor(rand() * 2);
    for (let k = 0; k < count; k++) {
      const b = pick(buyers);
      const u = { id: b.id, role: b.role, tier: tierForRole(b.role) };
      const items = b.items.filter(() => rand() > 0.35).map(([sku, lo, hi]) => ({ productId: prod[sku], quantity: lo + Math.floor(rand() * (hi - lo + 1)) }));
      if (!items.length) items.push({ productId: prod[b.items[0][0]], quantity: b.items[0][1] });
      let o;
      try { o = await orders.placeOrder(u, { items, addressId: b.addr, paymentMethod: pick(b.pay), deliverySlot: pick(['7 AM – 10 AM', '4 PM – 7 PM']), deliveryDate: addDays(today, -day + 1), source: rand() > 0.5 ? 'mobile' : 'web' }); } catch (e) { continue; }
      // Decide how far this order progressed.
      const target = day > 2 ? (rand() < 0.07 ? 'cancelled' : 'delivered') : pick(['pending', 'confirmed', 'packed', 'dispatched', 'out_for_delivery']);
      await db.transaction(async (trx) => {
        if (['razorpay'].includes(o.payment_method) && target !== 'pending' && target !== 'cancelled') {
          const [pid] = await trx('payments').insert({ order_id: o.id, user_id: u.id, method: 'razorpay', amount: o.grand_total, status: 'captured', provider_order_id: `order_demo_${o.id}`, provider_payment_id: `pay_demo_${o.id}` });
          await trx('orders').where({ id: o.id }).update({ amount_paid: o.grand_total, payment_status: 'paid' });
          await trx('payment_transactions').insert({ payment_id: pid, type: 'verify', amount: o.grand_total });
          await orders.transition(trx, o.id, 'confirmed', actor, 'Payment received');
        }
        if (o.payment_method === 'bank_transfer' && target !== 'pending' && target !== 'cancelled') {
          await trx('payments').insert({ order_id: o.id, user_id: u.id, method: 'bank_transfer', amount: o.grand_total, status: 'captured', reference_no: `UTR${o.id}DEMO`, verified_by: ids.admin, verified_at: trx.fn.now() });
          await trx('orders').where({ id: o.id }).update({ amount_paid: o.grand_total, payment_status: 'paid' });
          await orders.transition(trx, o.id, 'confirmed', actor);
        }
        if (target === 'cancelled') { await orders.transition(trx, o.id, 'cancelled', actor, 'Customer changed plans'); return; }
        let cur = (await trx('orders').where({ id: o.id }).first()).status;
        const stop = flow.indexOf(target);
        for (let i = flow.indexOf(cur) + 1; i <= stop; i++) {
          if (flow[i] === 'dispatched') {
            const driver = b.role === 'distributor' ? staff[ids.d2] : staff[ids.d1];
            await trx('delivery_assignments').insert({ order_id: o.id, staff_id: driver, assigned_by: ids.admin, status: 'picked_up', route_sequence: k + 1 });
          }
          if (flow[i] === 'delivered') {
            const fresh = await trx('orders').where({ id: o.id }).first();
            if (fresh.payment_method === 'cod') await payments.recordCash(trx, { orderId: o.id, amount: fresh.grand_total - fresh.amount_paid, by: ids.d1 });
          }
          await orders.transition(trx, o.id, flow[i], flow[i] === 'delivered' ? { id: ids.d1 } : actor);
          if (flow[i] === 'out_for_delivery') await trx('delivery_assignments').where({ order_id: o.id }).update({ status: 'out_for_delivery' });
          if (flow[i] === 'delivered') {
            const fresh = await trx('orders').where({ id: o.id }).first();
            const jarsBack = (await trx('jar_balances').where({ user_id: u.id }).first())?.jars_pending || 0;
            const back = Math.min(jarsBack, Math.floor(jarsBack * 0.8));
            if (back) await require('../services/jar.service').record(trx, { userId: u.id, orderId: o.id, type: 'returned', jars: back, note: 'Collected at delivery', by: ids.d1 });
            await trx('delivery_assignments').where({ order_id: o.id }).update({ status: 'delivered', cash_collected: fresh.payment_method === 'cod' ? fresh.grand_total : 0, empty_jars_collected: back, delivered_at: sqlTime(Date.now() - day * 86400e3) });
          }
          cur = flow[i];
        }
      });
      // Backdate so dashboards show history. 08:00–19:00 IST spread.
      const created = new Date(Date.now() - day * 86400e3);
      created.setUTCHours(3 + Math.floor(rand() * 10), Math.floor(rand() * 60));
      if (created > new Date()) created.setTime(Date.now() - 3600e3);
      const ts = sqlTime(created);
      await db('orders').where({ id: o.id }).update({ created_at: ts, ...(target === 'delivered' && { delivered_at: sqlTime(created.getTime() + 6 * 3600e3) }) });
      const hist = await db('order_status_history').where({ order_id: o.id }).orderBy('id');
      for (const [i, h] of hist.entries()) await db('order_status_history').where({ id: h.id }).update({ created_at: sqlTime(created.getTime() + i * 50 * 60e3) });
      await db('payments').where({ order_id: o.id }).update({ created_at: sqlTime(created.getTime() + 5 * 3600e3) });
      await db('invoices').where({ order_id: o.id }).update({ invoice_date: addDays(today, -day) });
    }
  }
  // Partial credit settlements so B2B outstanding is realistic.
  for (const uid of [ids.r1, ids.w1]) {
    const due = await orders.outstandingFor(db, uid);
    if (due > 0) await payments.recordCreditSettlement({ id: ids.admin }, { userId: uid, amount: Math.round(due * 0.6), method: 'bank_transfer', referenceNo: `NEFT-DEMO-${uid}` });
  }
  // A pending bank transfer to verify
  const openWh = await db('orders').where({ user_id: ids.w1, payment_method: 'bank_transfer', payment_status: 'unpaid' }).whereNot('status', 'cancelled').first();
  if (openWh) await payments.submitOffline({ id: ids.w1 }, { orderId: openWh.id, referenceNo: 'UTR998877665544', amount: openWh.grand_total, method: 'bank_transfer' });

  // ---- Subscriptions ----
  const u1 = { id: ids.c1, role: 'customer', tier: 'customer' };
  await subs.create(u1, { productId: prod['IBT-20L-JAR'], quantity: 2, frequency: 'alternate', addressId: addr.c1, deliverySlot: '7 AM – 10 AM', paymentMethod: 'cod', startDate: addDays(today, 1) });
  await subs.create({ id: ids.c3, role: 'customer', tier: 'customer' }, { productId: prod['IBT-20L-JAR'], quantity: 6, frequency: 'daily', addressId: addr.c3, deliverySlot: '7 AM – 10 AM', paymentMethod: 'cod', startDate: addDays(today, 1) });
  await subs.create({ id: ids.w1, role: 'wholesaler', tier: 'wholesaler' }, { productId: prod['IBT-1L-C12'], quantity: 20, frequency: 'custom', customWeekdays: [1, 4], addressId: addr.w1, paymentMethod: 'credit', startDate: addDays(today, 1) });

  // ---- Reviews & tickets ----
  const rv = [[ids.c1, 'IBT-20L-JAR', 5, 'Always on time, and the jar is spotless every refill.'], [ids.c3, 'IBT-1L-C12', 5, 'We stock IBT AQUA in every room. Guests like the taste.'], [ids.c2, 'IBT-20L-JAR', 4, 'Good water, reasonable price. Morning slot fills up fast.'], [ids.c1, 'IBT-1L-C12', 4, 'Handy for travel. Delivery partner was polite.']];
  for (const [uid, sku, rating, comment] of rv) await db('reviews').insert({ product_id: prod[sku], user_id: uid, rating, comment, status: 'approved' }).onConflict(['product_id', 'user_id']).ignore();
  const [tid] = await db('support_tickets').insert({ ticket_number: 'TKT-DEMO-0001', user_id: ids.c2, category: 'delivery', subject: 'Need evening delivery on Sundays', priority: 'normal' });
  await db('ticket_messages').insert({ ticket_id: tid, user_id: ids.c2, message: 'Can you deliver after 5 PM on Sundays? Nobody is home in the morning.' });
  await db('enquiries').insert({ type: 'bulk', name: 'Event Planner Demo', phone: '9000000501', business_name: 'Shaadi Events', message: '300 cases of 500ml for a wedding on the 20th.', details: JSON.stringify({ quantity: '300 cases', product: '500 ml', date: addDays(today, 13) }) });
  await db('credit_requests').insert({ user_id: ids.r1, requested_limit: R(40000), reason: 'Festival season stock-up' });

  await settings.set('demo_data_loaded', true);
}

module.exports = { load };
