/**
 * BASE SEED — safe for production. Idempotent: inserts only what is missing, never overwrites
 * values an admin has already changed. Business values here are placeholders to be set in
 * Admin → Settings before go-live.
 */
const bcrypt = require('bcryptjs');
const { ROLES, PERMISSIONS, ROLE_PERMISSIONS } = require('../../config/rbac');

const SETTINGS = [
  ['business_profile', {
    brand_name: 'IBT AQUA', legal_name: 'IBT ENTERPRISES', tagline: 'Pure. Safe. Delivered.',
    address: '', city: 'Medininagar (Daltonganj)', state: 'Jharkhand', district: 'Palamu', pincode: '',
    phone: '', whatsapp: '', email: '', sales_phone: '', gstin: '', fssai: '', bis_license: '',
    plant_location: null, // { lat, lng } of the plant, used as route origin
  }, 'business', 'Company details shown on site and invoices', true],
  ['bank_details', { account_name: '', bank: '', account_number: '', ifsc: '', upi_id: '' }, 'payments', 'Shown to B2B buyers paying by bank transfer', false],
  ['prices_include_gst', true, 'pricing', 'Entered prices already include GST (Indian MRP convention)', true],
  ['min_order_value_by_tier', { customer: 0, retailer: 0, wholesaler: 0, distributor: 0 }, 'pricing', 'Minimum order value in paise per buyer type', false],
  ['free_delivery_tiers', ['retailer', 'wholesaler', 'distributor'], 'delivery', 'Buyer types that never pay delivery charges', false],
  ['delivery_slots', ['7 AM – 10 AM', '10 AM – 1 PM', '1 PM – 4 PM', '4 PM – 7 PM'], 'delivery', 'Delivery time slots offered at checkout', true],
  ['payment_methods', { razorpay: true, upi: true, cod: true, bank_transfer: true, credit: true }, 'payments', 'Enable or disable payment methods', false],
  ['cod_max_amount', 500000, 'payments', 'Maximum order value (paise) for Cash on Delivery', false],
  ['auto_confirm_orders', { cod: true, credit: true, bank_transfer: false, razorpay: false, upi: false }, 'orders', 'Confirm orders automatically by payment method (online orders confirm on payment)', false],
  ['buyer_cancellable_statuses', ['pending', 'confirmed'], 'orders', 'Statuses in which buyers may cancel themselves', false],
  ['return_window_days', 2, 'orders', 'Days after delivery that a return can be requested', true],
  ['jar_deposit_amount', 0, 'jars', 'Refundable deposit per 20L jar (paise). 0 = no deposit', true],
  ['jar_deposit_tiers', ['customer'], 'jars', 'Buyer types charged a jar deposit', false],
  ['jar_deposit_mode', 'per_new_jar', 'jars', 'per_new_jar or none', false],
  ['jar_shortage_alert_threshold', 10, 'jars', 'Alert admins when a buyer holds this many empty jars', false],
  ['subscription_lead_days', 1, 'subscriptions', 'Create subscription orders this many days ahead', false],
  ['invoice_prefix', 'IBT', 'invoices', 'Invoice number prefix (PREFIX/FY/00001)', false],
  ['notification_channels', require('../../config/notifications').DEFAULT_CHANNELS, 'notifications', 'Channels per event type', false],
  ['unit_costs', {}, 'reports', 'Production cost per unit in paise by SKU, for profit estimates', false],
  ['social_links', { facebook: '', instagram: '', youtube: '' }, 'business', 'Social profiles', true],
];

const CATEGORIES = [
  ['500 ML Packaged Drinking Water', '500ml', 'Handy single-serve bottles for travel, events and shops.'],
  ['1 Litre Packaged Drinking Water', '1-litre', 'Everyday 1L bottles, sold singly or by the case.'],
  ['2 Litre Packaged Drinking Water', '2-litre', 'Family-size bottles for homes and offices.'],
  ['12 Litre Water Jar', '12-litre-jar', 'Compact jars for small offices and shops.'],
  ['20 Litre Water Jar', '20-litre-jar', 'Returnable 20L jars with doorstep refills.'],
  ['Bulk Water Supply', 'bulk-supply', 'Tanker and bulk supply for events, construction and institutions.'],
  ['Custom Business Orders', 'custom-business', 'Private-label bottles and custom quantities for businesses.'],
];

const PAGES = [
  ['about', 'About IBT AQUA'], ['privacy-policy', 'Privacy Policy'], ['terms', 'Terms and Conditions'], ['refund-policy', 'Refund and Return Policy'],
];

exports.seed = async (knex) => {
  for (const [name, r] of Object.entries(ROLES)) {
    if (!(await knex('roles').where({ name }).first())) await knex('roles').insert({ name, label: r.label, is_staff: !!r.staff });
  }
  for (const [key, description] of Object.entries(PERMISSIONS)) {
    if (!(await knex('permissions').where({ key }).first())) await knex('permissions').insert({ key, description });
  }
  for (const [role, perms] of Object.entries(ROLE_PERMISSIONS)) {
    const r = await knex('roles').where({ name: role }).first();
    for (const p of perms) {
      const pid = (await knex('permissions').where({ key: p }).first()).id;
      await knex('role_permissions').insert({ role_id: r.id, permission_id: pid }).onConflict(['role_id', 'permission_id']).ignore();
    }
  }
  for (const [key, value, group, description, isPublic] of SETTINGS) {
    if (!(await knex('system_settings').where({ key }).first())) await knex('system_settings').insert({ key, value: JSON.stringify(value), group, description, is_public: isPublic });
  }
  for (const [i, [name, slug, description]] of CATEGORIES.entries()) {
    if (!(await knex('categories').where({ slug }).first())) await knex('categories').insert({ name, slug, description, sort_order: i });
  }
  for (const [slug, title] of PAGES) {
    if (!(await knex('cms_content').where({ type: 'page', slug }).first())) {
      await knex('cms_content').insert({ type: 'page', slug, title, body: JSON.stringify({ markdown: `# ${title}\n\n_This page has not been written yet. Edit it in Admin → Website CMS._` }) });
    }
  }
  for (const name of ['PET Preforms (500ml)', 'PET Preforms (1L)', 'PET Preforms (2L)', 'Caps', 'Labels', 'Shrink Film (kg)', 'Empty 20L Jars', 'Empty 12L Jars', 'Jar Caps & Seals']) {
    if (!(await knex('packaging_materials').where({ name }).first())) await knex('packaging_materials').insert({ name, unit: name.includes('kg') ? 'kg' : 'pcs' });
  }

  // First super admin from environment (production). Dev demo accounts live in 02_dev_demo.
  const { SUPER_ADMIN_PHONE: phone, SUPER_ADMIN_EMAIL: email, SUPER_ADMIN_PASSWORD: pw } = process.env;
  if (phone && pw && !(await knex('users').where({ phone }).first())) {
    const role = await knex('roles').where({ name: 'super_admin' }).first();
    await knex('users').insert({ role_id: role.id, name: 'Super Admin', phone, email: email || null, password_hash: await bcrypt.hash(pw, 12) });
    console.log(`Created super admin ${phone}`);
  }
};
