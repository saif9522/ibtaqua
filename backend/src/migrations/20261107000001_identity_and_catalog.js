/**
 * Identity, RBAC, business profiles, catalog, pricing, settings.
 * All money columns are INTEGER paise (₹1 = 100) to avoid float rounding.
 */
const ts = (t, knex) => {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
};

exports.up = async (knex) => {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id');
    t.string('name', 40).notNullable().unique(); // super_admin, admin, customer, retailer, wholesaler, distributor, delivery
    t.string('label', 80).notNullable();
    t.boolean('is_staff').notNullable().defaultTo(false);
  });

  await knex.schema.createTable('permissions', (t) => {
    t.increments('id');
    t.string('key', 80).notNullable().unique(); // e.g. products.write
    t.string('description', 200);
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('roles.id').onDelete('CASCADE');
    t.integer('permission_id').unsigned().notNullable().references('permissions.id').onDelete('CASCADE');
    t.primary(['role_id', 'permission_id']);
  });

  await knex.schema.createTable('delivery_zones', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable().unique();
    t.text('pincodes').notNullable().defaultTo('[]'); // JSON array of pincodes
    t.integer('delivery_charge').notNullable().defaultTo(0);
    t.integer('free_delivery_above').nullable();
    t.integer('min_order_value').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t, knex);
  });

  await knex.schema.createTable('users', (t) => {
    t.increments('id');
    t.integer('role_id').unsigned().notNullable().references('roles.id');
    t.string('name', 120).notNullable();
    t.string('phone', 15).notNullable().unique();
    t.string('email', 160).nullable().unique();
    t.string('password_hash', 120).nullable(); // staff & B2B; customers may be OTP-only
    t.enu('status', ['active', 'pending', 'suspended', 'rejected']).notNullable().defaultTo('active');
    t.integer('token_version').notNullable().defaultTo(0); // bump to revoke all sessions
    t.timestamp('last_login_at').nullable();
    ts(t, knex);
    t.index(['role_id', 'status']);
  });

  await knex.schema.createTable('otp_codes', (t) => {
    t.increments('id');
    t.string('phone', 15).notNullable();
    t.string('purpose', 30).notNullable().defaultTo('login');
    t.string('code_hash', 120).notNullable();
    t.integer('attempts').notNullable().defaultTo(0);
    t.timestamp('expires_at').notNullable();
    t.timestamp('consumed_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['phone', 'purpose']);
  });

  await knex.schema.createTable('refresh_tokens', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('token_hash', 128).notNullable().unique();
    t.string('user_agent', 255);
    t.timestamp('expires_at').notNullable();
    t.timestamp('revoked_at').nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('user_addresses', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('label', 40).defaultTo('Home');
    t.string('contact_name', 120).notNullable();
    t.string('contact_phone', 15).notNullable();
    t.string('line1', 200).notNullable();
    t.string('line2', 200);
    t.string('landmark', 120);
    t.string('city', 80).notNullable();
    t.string('state', 80).notNullable();
    t.string('pincode', 10).notNullable();
    t.decimal('lat', 10, 7);
    t.decimal('lng', 10, 7);
    t.integer('zone_id').unsigned().references('delivery_zones.id').onDelete('SET NULL');
    t.boolean('is_default').notNullable().defaultTo(false);
    ts(t, knex);
    t.index('user_id');
  });

  await knex.schema.createTable('customers', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().unique().references('users.id').onDelete('CASCADE');
    t.string('customer_type', 30).defaultTo('home'); // home, office, hotel...
    ts(t, knex);
  });

  const business = (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().unique().references('users.id').onDelete('CASCADE');
    t.string('business_name', 160).notNullable();
    t.string('gstin', 15).nullable();
    t.string('pan', 10).nullable();
    t.string('contact_person', 120);
    t.string('business_address', 300);
    t.string('city', 80);
    t.string('state', 80);
    t.string('pincode', 10);
    t.enu('approval_status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    t.string('rejection_reason', 300);
    t.integer('approved_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('approved_at');
    t.integer('credit_limit').notNullable().defaultTo(0);
    t.integer('credit_days').notNullable().defaultTo(0);
    t.boolean('credit_enabled').notNullable().defaultTo(false);
    ts(t, knex);
    t.index('approval_status');
  };
  await knex.schema.createTable('retailers', business);
  await knex.schema.createTable('wholesalers', business);
  await knex.schema.createTable('distributors', (t) => {
    business(t);
    t.string('agreement_ref', 80);
    t.date('agreement_valid_to');
  });

  await knex.schema.createTable('distributor_zones', (t) => {
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('zone_id').unsigned().notNullable().references('delivery_zones.id').onDelete('CASCADE');
    t.primary(['user_id', 'zone_id']);
  });

  await knex.schema.createTable('business_documents', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('doc_type', 40).notNullable(); // gst_certificate, pan, trade_license, other
    t.string('file_path', 255).notNullable();
    t.string('original_name', 255);
    t.string('mime', 80);
    t.integer('size_bytes');
    t.enu('status', ['pending', 'verified', 'rejected']).notNullable().defaultTo('pending');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
  });

  await knex.schema.createTable('credit_requests', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('requested_limit').notNullable();
    t.string('reason', 500);
    t.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    t.integer('decided_by').unsigned().references('users.id').onDelete('SET NULL');
    t.string('decision_note', 300);
    ts(t, knex);
  });

  await knex.schema.createTable('categories', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable();
    t.string('slug', 140).notNullable().unique();
    t.string('description', 500);
    t.string('image', 255);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t, knex);
  });

  await knex.schema.createTable('products', (t) => {
    t.increments('id');
    t.integer('category_id').unsigned().notNullable().references('categories.id');
    t.string('name', 160).notNullable();
    t.string('slug', 180).notNullable().unique();
    t.string('sku', 60).notNullable().unique();
    t.text('description');
    t.integer('size_ml').notNullable(); // 500, 1000, 20000...
    t.enu('unit_type', ['bottle', 'case', 'jar', 'bulk']).notNullable().defaultTo('bottle');
    t.integer('units_per_pack').notNullable().defaultTo(1); // bottles per case
    t.integer('mrp').notNullable();
    t.decimal('gst_percent', 5, 2).notNullable();
    t.string('hsn_code', 12);
    t.string('packaging_info', 300);
    t.boolean('is_returnable_jar').notNullable().defaultTo(false);
    t.enu('status', ['active', 'inactive', 'out_of_stock']).notNullable().defaultTo('active');
    t.boolean('is_featured').notNullable().defaultTo(false);
    t.string('image', 255);
    ts(t, knex);
    t.index(['category_id', 'status']);
  });

  await knex.schema.createTable('product_images', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('path', 255).notNullable();
    t.integer('sort_order').notNullable().defaultTo(0);
  });

  // Base tier prices + optional zone overrides + optional per-user negotiated prices.
  await knex.schema.createTable('product_prices', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.enu('tier', ['customer', 'retailer', 'wholesaler', 'distributor']).notNullable();
    t.integer('zone_id').unsigned().nullable().references('delivery_zones.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE');
    t.integer('price').notNullable();
    t.integer('min_order_qty').notNullable().defaultTo(1);
    t.decimal('discount_percent', 5, 2).notNullable().defaultTo(0); // product-wise discount
    t.date('valid_from').nullable();
    t.date('valid_to').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t, knex);
    t.index(['product_id', 'tier']);
    t.index('user_id');
  });

  await knex.schema.createTable('quantity_discounts', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.enu('tier', ['customer', 'retailer', 'wholesaler', 'distributor']).notNullable();
    t.integer('min_qty').notNullable();
    t.decimal('discount_percent', 5, 2).notNullable();
    t.unique(['product_id', 'tier', 'min_qty']);
  });

  await knex.schema.createTable('system_settings', (t) => {
    t.increments('id');
    t.string('key', 80).notNullable().unique();
    t.text('value').notNullable(); // JSON
    t.string('group', 40).notNullable().defaultTo('general');
    t.string('description', 300);
    t.boolean('is_public').notNullable().defaultTo(false); // exposed to storefront
    ts(t, knex);
  });

  await knex.schema.createTable('cms_content', (t) => {
    t.increments('id');
    t.string('type', 30).notNullable(); // banner, page, faq, testimonial, section
    t.string('slug', 120).notNullable();
    t.string('title', 200);
    t.text('body'); // JSON or markdown
    t.string('image', 255);
    t.string('link', 255);
    t.integer('sort_order').notNullable().defaultTo(0);
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t, knex);
    t.unique(['type', 'slug']);
  });

  await knex.schema.createTable('audit_logs', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().nullable().references('users.id').onDelete('SET NULL');
    t.string('action', 80).notNullable();
    t.string('entity', 60);
    t.string('entity_id', 40);
    t.text('meta');
    t.string('ip', 64);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['entity', 'entity_id']);
    t.index('created_at');
  });
};

exports.down = async (knex) => {
  for (const tbl of [
    'audit_logs', 'cms_content', 'system_settings', 'quantity_discounts', 'product_prices', 'product_images',
    'products', 'categories', 'credit_requests', 'business_documents', 'distributor_zones', 'distributors',
    'wholesalers', 'retailers', 'customers', 'user_addresses', 'refresh_tokens', 'otp_codes', 'users',
    'delivery_zones', 'role_permissions', 'permissions', 'roles',
  ]) await knex.schema.dropTableIfExists(tbl);
};
