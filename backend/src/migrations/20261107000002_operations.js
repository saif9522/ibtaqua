/**
 * Inventory, orders, payments, invoices, delivery, jars, subscriptions,
 * coupons, notifications, reviews, support, enquiries.
 */
const ts = (t, knex) => {
  t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  t.timestamp('updated_at').notNullable().defaultTo(knex.fn.now());
};

const ORDER_STATUSES = [
  'pending', 'confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched',
  'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned',
];

exports.up = async (knex) => {
  // ---------- Inventory ----------
  await knex.schema.createTable('inventory', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().unique().references('products.id').onDelete('CASCADE');
    t.integer('quantity_available').notNullable().defaultTo(0); // sellable, not reserved
    t.integer('quantity_reserved').notNullable().defaultTo(0); // allocated to open orders
    t.integer('quantity_damaged').notNullable().defaultTo(0);
    t.integer('low_stock_threshold').notNullable().defaultTo(50);
    ts(t, knex);
  });

  await knex.schema.createTable('inventory_batches', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.string('batch_number', 60).notNullable().unique();
    t.date('manufacturing_date').notNullable();
    t.date('expiry_date').notNullable();
    t.integer('quantity_produced').notNullable();
    t.integer('quantity_remaining').notNullable();
    t.enu('status', ['active', 'depleted', 'expired', 'quarantined']).notNullable().defaultTo('active');
    t.string('notes', 300);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    ts(t, knex);
    t.index(['product_id', 'status', 'expiry_date']);
  });

  await knex.schema.createTable('packaging_materials', (t) => {
    t.increments('id');
    t.string('name', 120).notNullable().unique(); // preforms, caps, labels, shrink film, empty 20L jars
    t.string('unit', 20).notNullable().defaultTo('pcs');
    t.integer('quantity').notNullable().defaultTo(0);
    t.integer('low_stock_threshold').notNullable().defaultTo(0);
    ts(t, knex);
  });

  await knex.schema.createTable('stock_movements', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().nullable().references('products.id').onDelete('CASCADE');
    t.integer('material_id').unsigned().nullable().references('packaging_materials.id').onDelete('CASCADE');
    t.integer('batch_id').unsigned().nullable().references('inventory_batches.id').onDelete('SET NULL');
    t.enu('type', ['production', 'reserve', 'release', 'dispatch', 'return', 'damage', 'adjustment', 'expiry', 'material_in', 'material_out']).notNullable();
    t.integer('quantity').notNullable(); // signed
    t.string('reference_type', 40);
    t.string('reference_id', 40);
    t.string('note', 300);
    t.integer('created_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['product_id', 'created_at']);
  });

  // ---------- Coupons ----------
  await knex.schema.createTable('coupons', (t) => {
    t.increments('id');
    t.string('code', 40).notNullable().unique();
    t.string('description', 200);
    t.enu('discount_type', ['percent', 'flat']).notNullable();
    t.integer('value').notNullable(); // percent (e.g. 10) or paise
    t.integer('max_discount').nullable();
    t.integer('min_order_value').notNullable().defaultTo(0);
    t.text('applicable_tiers').notNullable().defaultTo('["customer"]');
    t.integer('usage_limit').nullable();
    t.integer('per_user_limit').notNullable().defaultTo(1);
    t.integer('used_count').notNullable().defaultTo(0);
    t.timestamp('valid_from').nullable();
    t.timestamp('valid_to').nullable();
    t.boolean('is_active').notNullable().defaultTo(true);
    ts(t, knex);
  });

  // ---------- Subscriptions (declared before orders for FK) ----------
  await knex.schema.createTable('subscriptions', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id');
    t.integer('quantity').notNullable();
    t.enu('frequency', ['daily', 'alternate', 'weekly', 'monthly', 'custom']).notNullable();
    t.text('custom_weekdays'); // JSON [0..6] for custom
    t.integer('address_id').unsigned().notNullable().references('user_addresses.id');
    t.string('delivery_slot', 40);
    t.string('payment_method', 20).notNullable().defaultTo('cod');
    t.date('start_date').notNullable();
    t.date('end_date');
    t.date('next_run_date');
    t.enu('status', ['active', 'paused', 'cancelled']).notNullable().defaultTo('active');
    t.date('paused_until');
    ts(t, knex);
    t.index(['status', 'next_run_date']);
  });

  // ---------- Orders ----------
  await knex.schema.createTable('orders', (t) => {
    t.increments('id');
    t.string('order_number', 30).notNullable().unique();
    t.integer('user_id').unsigned().notNullable().references('users.id');
    t.enu('buyer_tier', ['customer', 'retailer', 'wholesaler', 'distributor']).notNullable();
    t.enu('status', ORDER_STATUSES).notNullable().defaultTo('pending');
    t.enu('payment_method', ['razorpay', 'upi', 'cod', 'bank_transfer', 'credit']).notNullable();
    t.enu('payment_status', ['unpaid', 'pending_verification', 'partially_paid', 'paid', 'refunded', 'partially_refunded', 'failed']).notNullable().defaultTo('unpaid');
    t.integer('subtotal').notNullable(); // taxable value before coupon
    t.integer('discount_total').notNullable().defaultTo(0);
    t.integer('taxable_total').notNullable();
    t.integer('gst_total').notNullable();
    t.integer('delivery_charge').notNullable().defaultTo(0);
    t.integer('jar_deposit_total').notNullable().defaultTo(0);
    t.integer('grand_total').notNullable();
    t.integer('amount_paid').notNullable().defaultTo(0);
    t.integer('coupon_id').unsigned().references('coupons.id').onDelete('SET NULL');
    t.integer('address_id').unsigned().references('user_addresses.id').onDelete('SET NULL');
    t.text('address_snapshot').notNullable(); // JSON — orders keep the address they shipped to
    t.integer('zone_id').unsigned().references('delivery_zones.id').onDelete('SET NULL');
    t.date('delivery_date');
    t.string('delivery_slot', 40);
    t.string('delivery_otp', 6); // shown to the buyer only; staff must enter it to mark delivered
    t.string('notes', 500);
    t.enu('source', ['web', 'mobile', 'admin', 'subscription']).notNullable().defaultTo('web');
    t.integer('subscription_id').unsigned().references('subscriptions.id').onDelete('SET NULL');
    t.date('due_date'); // credit orders
    t.timestamp('delivered_at');
    t.timestamp('cancelled_at');
    t.string('cancel_reason', 300);
    ts(t, knex);
    t.index(['user_id', 'created_at']);
    t.index(['status', 'created_at']);
    t.index('payment_status');
  });

  await knex.schema.createTable('order_items', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('product_id').unsigned().notNullable().references('products.id');
    t.string('product_name', 160).notNullable();
    t.string('sku', 60).notNullable();
    t.integer('quantity').notNullable();
    t.integer('mrp').notNullable();
    t.integer('unit_price').notNullable(); // tier price incl. GST, after product/qty discount
    t.decimal('gst_percent', 5, 2).notNullable();
    t.integer('taxable_amount').notNullable();
    t.integer('gst_amount').notNullable();
    t.integer('line_total').notNullable();
    t.integer('jar_deposit').notNullable().defaultTo(0);
    t.string('price_source', 40); // base|zone|negotiated
    t.index('order_id');
    t.index('product_id');
  });

  await knex.schema.createTable('order_item_batches', (t) => {
    t.increments('id');
    t.integer('order_item_id').unsigned().notNullable().references('order_items.id').onDelete('CASCADE');
    t.integer('batch_id').unsigned().notNullable().references('inventory_batches.id');
    t.integer('quantity').notNullable();
  });

  await knex.schema.createTable('order_status_history', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.string('from_status', 30);
    t.string('to_status', 30).notNullable();
    t.string('note', 300);
    t.integer('changed_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('order_id');
  });

  await knex.schema.createTable('coupon_usage', (t) => {
    t.increments('id');
    t.integer('coupon_id').unsigned().notNullable().references('coupons.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().notNullable().unique().references('orders.id').onDelete('CASCADE');
    t.integer('discount_amount').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['coupon_id', 'user_id']);
  });

  await knex.schema.createTable('subscription_orders', (t) => {
    t.increments('id');
    t.integer('subscription_id').unsigned().notNullable().references('subscriptions.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().nullable().references('orders.id').onDelete('SET NULL');
    t.date('scheduled_date').notNullable();
    t.enu('status', ['created', 'skipped', 'failed']).notNullable().defaultTo('created');
    t.string('note', 300);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.unique(['subscription_id', 'scheduled_date']); // idempotent generation
  });

  await knex.schema.createTable('return_requests', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id');
    t.string('reason', 500).notNullable();
    t.enu('status', ['requested', 'approved', 'rejected', 'completed']).notNullable().defaultTo('requested');
    t.integer('refund_amount').notNullable().defaultTo(0);
    t.string('admin_note', 300);
    ts(t, knex);
  });

  // ---------- Payments ----------
  await knex.schema.createTable('payments', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().nullable().references('orders.id').onDelete('SET NULL');
    t.integer('user_id').unsigned().notNullable().references('users.id');
    t.enu('method', ['razorpay', 'upi', 'cod', 'bank_transfer', 'credit_settlement', 'cash']).notNullable();
    t.integer('amount').notNullable();
    t.integer('refunded_amount').notNullable().defaultTo(0);
    t.enu('status', ['created', 'pending_verification', 'captured', 'failed', 'refunded', 'partially_refunded', 'rejected']).notNullable().defaultTo('created');
    t.string('provider_order_id', 80).nullable().unique();
    t.string('provider_payment_id', 80).nullable().unique(); // dup prevention
    t.string('reference_no', 80); // UTR / bank ref
    t.string('failure_reason', 300);
    t.integer('verified_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('verified_at');
    ts(t, knex);
    t.index(['order_id', 'status']);
    t.index('user_id');
  });

  await knex.schema.createTable('payment_transactions', (t) => {
    t.increments('id');
    t.integer('payment_id').unsigned().nullable().references('payments.id').onDelete('CASCADE');
    t.enu('type', ['create', 'verify', 'capture', 'fail', 'refund', 'webhook', 'manual']).notNullable();
    t.integer('amount');
    t.string('provider_event_id', 120).nullable().unique(); // webhook replay protection
    t.text('payload');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('invoices', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().unique().references('orders.id').onDelete('CASCADE');
    t.string('invoice_number', 40).notNullable().unique();
    t.date('invoice_date').notNullable();
    t.string('buyer_name', 160);
    t.string('buyer_gstin', 15);
    t.string('place_of_supply', 80);
    t.boolean('is_interstate').notNullable().defaultTo(false);
    t.integer('taxable_value').notNullable();
    t.integer('cgst').notNullable().defaultTo(0);
    t.integer('sgst').notNullable().defaultTo(0);
    t.integer('igst').notNullable().defaultTo(0);
    t.integer('total').notNullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  // ---------- Delivery ----------
  await knex.schema.createTable('delivery_staff', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().unique().references('users.id').onDelete('CASCADE');
    t.string('vehicle_number', 20);
    t.integer('zone_id').unsigned().references('delivery_zones.id').onDelete('SET NULL');
    t.boolean('is_available').notNullable().defaultTo(true);
    ts(t, knex);
  });

  await knex.schema.createTable('delivery_assignments', (t) => {
    t.increments('id');
    t.integer('order_id').unsigned().notNullable().references('orders.id').onDelete('CASCADE');
    t.integer('staff_id').unsigned().notNullable().references('delivery_staff.id');
    t.enu('status', ['assigned', 'picked_up', 'out_for_delivery', 'delivered', 'failed', 'reassigned']).notNullable().defaultTo('assigned');
    t.integer('route_sequence');
    t.integer('cash_collected').notNullable().defaultTo(0);
    t.integer('empty_jars_collected').notNullable().defaultTo(0);
    t.string('failure_reason', 300);
    t.string('notes', 300);
    t.integer('assigned_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('delivered_at');
    ts(t, knex);
    t.index(['staff_id', 'status']);
    t.index('order_id');
  });

  // ---------- Jars ----------
  await knex.schema.createTable('jar_balances', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().unique().references('users.id').onDelete('CASCADE');
    t.integer('jars_delivered').notNullable().defaultTo(0);
    t.integer('jars_returned').notNullable().defaultTo(0);
    t.integer('jars_pending').notNullable().defaultTo(0); // with customer
    t.integer('deposit_held').notNullable().defaultTo(0);
    ts(t, knex);
  });

  await knex.schema.createTable('jar_transactions', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().nullable().references('orders.id').onDelete('SET NULL');
    t.enu('type', ['issued', 'returned', 'deposit_collected', 'deposit_refunded', 'adjustment', 'damaged', 'lost']).notNullable();
    t.integer('jars').notNullable().defaultTo(0);
    t.integer('amount').notNullable().defaultTo(0);
    t.string('note', 300);
    t.integer('recorded_by').unsigned().references('users.id').onDelete('SET NULL');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index('user_id');
  });

  // ---------- Engagement ----------
  await knex.schema.createTable('notifications', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().nullable().references('users.id').onDelete('CASCADE'); // null = role broadcast
    t.string('audience_role', 40); // for broadcasts
    t.string('type', 40).notNullable();
    t.string('title', 160).notNullable();
    t.string('body', 1000);
    t.text('data');
    t.text('channels').notNullable().defaultTo('["in_app"]');
    t.boolean('is_read').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'is_read']);
  });

  await knex.schema.createTable('notification_outbox', (t) => {
    t.increments('id');
    t.integer('notification_id').unsigned().references('notifications.id').onDelete('CASCADE');
    t.enu('channel', ['email', 'sms', 'whatsapp', 'push']).notNullable();
    t.string('recipient', 160).notNullable();
    t.text('payload');
    t.enu('status', ['queued', 'sent', 'failed', 'skipped']).notNullable().defaultTo('queued');
    t.integer('attempts').notNullable().defaultTo(0);
    t.string('error', 300);
    ts(t, knex);
    t.index('status');
  });

  await knex.schema.createTable('device_tokens', (t) => {
    t.increments('id');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.string('token', 255).notNullable().unique();
    t.string('platform', 20);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('reviews', (t) => {
    t.increments('id');
    t.integer('product_id').unsigned().notNullable().references('products.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().nullable().references('orders.id').onDelete('SET NULL');
    t.integer('rating').notNullable();
    t.string('comment', 1000);
    t.enu('status', ['pending', 'approved', 'rejected']).notNullable().defaultTo('pending');
    ts(t, knex);
    t.unique(['product_id', 'user_id']);
  });

  await knex.schema.createTable('support_tickets', (t) => {
    t.increments('id');
    t.string('ticket_number', 30).notNullable().unique();
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.integer('order_id').unsigned().nullable().references('orders.id').onDelete('SET NULL');
    t.string('category', 40).notNullable().defaultTo('general'); // complaint, delivery, payment, quality, sales
    t.string('subject', 200).notNullable();
    t.enu('status', ['open', 'in_progress', 'resolved', 'closed']).notNullable().defaultTo('open');
    t.enu('priority', ['low', 'normal', 'high']).notNullable().defaultTo('normal');
    ts(t, knex);
    t.index(['status', 'created_at']);
  });

  await knex.schema.createTable('ticket_messages', (t) => {
    t.increments('id');
    t.integer('ticket_id').unsigned().notNullable().references('support_tickets.id').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('users.id').onDelete('CASCADE');
    t.text('message').notNullable();
    t.boolean('is_staff').notNullable().defaultTo(false);
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });

  await knex.schema.createTable('enquiries', (t) => {
    t.increments('id');
    t.enu('type', ['contact', 'bulk', 'partnership']).notNullable();
    t.string('name', 120).notNullable();
    t.string('phone', 15).notNullable();
    t.string('email', 160);
    t.string('business_name', 160);
    t.string('message', 2000);
    t.text('details');
    t.enu('status', ['new', 'contacted', 'closed']).notNullable().defaultTo('new');
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
  });
};

exports.down = async (knex) => {
  for (const tbl of [
    'enquiries', 'ticket_messages', 'support_tickets', 'reviews', 'device_tokens', 'notification_outbox',
    'notifications', 'jar_transactions', 'jar_balances', 'delivery_assignments', 'delivery_staff', 'invoices',
    'payment_transactions', 'payments', 'return_requests', 'subscription_orders', 'coupon_usage',
    'order_status_history', 'order_item_batches', 'order_items', 'orders', 'subscriptions', 'coupons',
    'stock_movements', 'packaging_materials', 'inventory_batches', 'inventory',
  ]) await knex.schema.dropTableIfExists(tbl);
};
