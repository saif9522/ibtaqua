/**
 * Reports + dashboard. Revenue = grand_total of orders not cancelled/returned (booked revenue);
 * collected cash is reported separately from payments. All amounts in paise.
 * Dates use IST via SQLite's '+330 minutes' modifier.
 */
const ExcelJS = require('exceljs');
const PDFDocument = require('pdfkit');
const db = require('../database/db');
const { todayIST } = require('../utils/helpers');

const IST = "datetime(o.created_at, '+330 minutes')";
const LIVE = (q, alias = 'o') => q.whereNotIn(`${alias}.status`, ['cancelled', 'returned']);

async function dashboard() {
  const today = todayIST();
  const month = today.slice(0, 7);
  const one = async (q) => Object.values((await q.first()) || {})[0] || 0;
  const [totalRevenue, todayRevenue, monthRevenue, totalOrders, pendingOrders, deliveredOrders] = await Promise.all([
    one(LIVE(db('orders as o')).sum({ v: 'grand_total' })),
    one(LIVE(db('orders as o')).whereRaw(`date(${IST}) = ?`, [today]).sum({ v: 'grand_total' })),
    one(LIVE(db('orders as o')).whereRaw(`strftime('%Y-%m', ${IST}) = ?`, [month]).sum({ v: 'grand_total' })),
    one(db('orders').count({ v: '*' })),
    one(db('orders').whereIn('status', ['pending', 'confirmed', 'processing', 'packed', 'ready_for_dispatch']).count({ v: '*' })),
    one(db('orders').where('status', 'delivered').count({ v: '*' })),
  ]);
  const roleCount = (role, approved = true) => {
    const q = db('users as u').join('roles as r', 'r.id', 'u.role_id').where('r.name', role).count({ v: '*' });
    if (approved) q.andWhere('u.status', 'active');
    return one(q);
  };
  const [customers, retailers, wholesalers, distributors, products, lowStock, outstanding, pendingApprovals, pendingPayments] = await Promise.all([
    roleCount('customer'), roleCount('retailer'), roleCount('wholesaler'), roleCount('distributor'),
    one(db('products').count({ v: '*' })),
    one(db('inventory').whereRaw('quantity_available <= low_stock_threshold').count({ v: '*' })),
    one(LIVE(db('orders as o')).sum({ v: db.raw('grand_total - amount_paid') })),
    one(db('users').where('status', 'pending').count({ v: '*' })),
    one(db('payments').where('status', 'pending_verification').count({ v: '*' })),
  ]);

  const daily = await LIVE(db('orders as o')).whereRaw(`date(${IST}) >= date(?, '-29 days')`, [today])
    .select(db.raw(`date(${IST}) as label`)).sum({ revenue: 'grand_total' }).count({ orders: '*' }).groupBy('label').orderBy('label');
  const monthly = await LIVE(db('orders as o')).whereRaw(`date(${IST}) >= date(?, 'start of month', '-11 months')`, [today])
    .select(db.raw(`strftime('%Y-%m', ${IST}) as label`)).sum({ revenue: 'grand_total' }).count({ orders: '*' }).groupBy('label').orderBy('label');
  const yearly = await LIVE(db('orders as o')).select(db.raw(`strftime('%Y', ${IST}) as label`)).sum({ revenue: 'grand_total' }).groupBy('label').orderBy('label');
  const byTier = await LIVE(db('orders as o')).select('buyer_tier as label').sum({ revenue: 'grand_total' }).count({ orders: '*' }).groupBy('buyer_tier');
  const bestSellers = await db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id').whereNotIn('o.status', ['cancelled', 'returned'])
    .select('oi.product_id', 'oi.product_name as label').sum({ quantity: 'oi.quantity', revenue: 'oi.line_total' }).groupBy('oi.product_id', 'oi.product_name').orderBy('quantity', 'desc').limit(6);
  const statusDist = await db('orders').select('status as label').count({ value: '*' }).groupBy('status');
  const recentOrders = await db('orders as o').join('users as u', 'u.id', 'o.user_id').orderBy('o.id', 'desc').limit(8)
    .select('o.id', 'o.order_number', 'o.status', 'o.grand_total', 'o.buyer_tier', 'o.payment_status', 'o.created_at', 'u.name');

  return {
    stats: { totalRevenue, todayRevenue, monthRevenue, totalOrders, pendingOrders, deliveredOrders, customers, retailers, wholesalers, distributors, products, lowStock, outstanding, pendingApprovals, pendingPayments },
    charts: { daily, monthly, yearly, byTier, bestSellers, statusDist },
    recentOrders,
  };
}

const range = (q, from, to, col = IST) => {
  if (from) q.whereRaw(`date(${col}) >= ?`, [from]);
  if (to) q.whereRaw(`date(${col}) <= ?`, [to]);
  return q;
};

/** Each report returns { title, columns: [{key,label,money?}], rows }. */
const REPORTS = {
  sales: async ({ from, to, group = 'day' }) => {
    const fmt = { day: '%Y-%m-%d', month: '%Y-%m', year: '%Y' }[group] || '%Y-%m-%d';
    const rows = await range(LIVE(db('orders as o')), from, to)
      .select(db.raw(`strftime('${fmt}', ${IST}) as period`)).count({ orders: '*' })
      .sum({ taxable: 'taxable_total', gst: 'gst_total', delivery: 'delivery_charge', discount: 'discount_total', total: 'grand_total', collected: 'amount_paid' })
      .groupBy('period').orderBy('period');
    return { title: `Sales by ${group}`, columns: [{ key: 'period', label: 'Period' }, { key: 'orders', label: 'Orders' }, { key: 'taxable', label: 'Taxable', money: 1 }, { key: 'gst', label: 'GST', money: 1 }, { key: 'discount', label: 'Discount', money: 1 }, { key: 'delivery', label: 'Delivery', money: 1 }, { key: 'total', label: 'Total', money: 1 }, { key: 'collected', label: 'Collected', money: 1 }], rows };
  },
  buyers: async ({ from, to, tier }) => {
    const q = range(LIVE(db('orders as o')).join('users as u', 'u.id', 'o.user_id'), from, to)
      .select('u.id', 'u.name', 'u.phone', 'o.buyer_tier as tier').count({ orders: '*' }).sum({ total: 'o.grand_total', paid: 'o.amount_paid' })
      .groupBy('u.id', 'u.name', 'u.phone', 'o.buyer_tier').orderBy('total', 'desc');
    if (tier) q.andWhere('o.buyer_tier', tier);
    const rows = (await q).map((r) => ({ ...r, due: r.total - r.paid }));
    return { title: `${tier ? `${tier[0].toUpperCase()}${tier.slice(1)}` : 'Buyer'} purchases`, columns: [{ key: 'name', label: 'Name' }, { key: 'phone', label: 'Phone' }, { key: 'tier', label: 'Type' }, { key: 'orders', label: 'Orders' }, { key: 'total', label: 'Purchased', money: 1 }, { key: 'paid', label: 'Paid', money: 1 }, { key: 'due', label: 'Due', money: 1 }], rows };
  },
  products: async ({ from, to }) => {
    const rows = await range(db('order_items as oi').join('orders as o', 'o.id', 'oi.order_id').whereNotIn('o.status', ['cancelled', 'returned']), from, to)
      .select('oi.sku', 'oi.product_name as name').sum({ quantity: 'oi.quantity', taxable: 'oi.taxable_amount', gst: 'oi.gst_amount', total: 'oi.line_total' })
      .groupBy('oi.sku', 'oi.product_name').orderBy('total', 'desc');
    return { title: 'Product-wise sales', columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'quantity', label: 'Qty' }, { key: 'taxable', label: 'Taxable', money: 1 }, { key: 'gst', label: 'GST', money: 1 }, { key: 'total', label: 'Total', money: 1 }], rows };
  },
  gst: async ({ from, to }) => {
    const rows = await range(db('invoices as i').join('orders as o', 'o.id', 'i.order_id').whereNotIn('o.status', ['cancelled']), from, to, 'i.invoice_date')
      .select('i.invoice_number', 'i.invoice_date', 'i.buyer_name', 'i.buyer_gstin', 'i.place_of_supply', 'i.taxable_value', 'i.cgst', 'i.sgst', 'i.igst', 'i.total').orderBy('i.invoice_date');
    return { title: 'GST register (outward supplies)', columns: [{ key: 'invoice_number', label: 'Invoice' }, { key: 'invoice_date', label: 'Date' }, { key: 'buyer_name', label: 'Buyer' }, { key: 'buyer_gstin', label: 'GSTIN' }, { key: 'place_of_supply', label: 'POS' }, { key: 'taxable_value', label: 'Taxable', money: 1 }, { key: 'cgst', label: 'CGST', money: 1 }, { key: 'sgst', label: 'SGST', money: 1 }, { key: 'igst', label: 'IGST', money: 1 }, { key: 'total', label: 'Total', money: 1 }], rows };
  },
  payments: async ({ from, to }) => {
    const rows = await range(db('payments as p').leftJoin('orders as o', 'o.id', 'p.order_id').join('users as u', 'u.id', 'p.user_id'), from, to, "datetime(p.created_at, '+330 minutes')")
      .select('p.id', 'p.created_at', 'o.order_number', 'u.name', 'p.method', 'p.status', 'p.amount', 'p.refunded_amount', 'p.reference_no', 'p.provider_payment_id').orderBy('p.id', 'desc');
    return { title: 'Payments', columns: [{ key: 'created_at', label: 'Time (UTC)' }, { key: 'order_number', label: 'Order' }, { key: 'name', label: 'Payer' }, { key: 'method', label: 'Method' }, { key: 'status', label: 'Status' }, { key: 'amount', label: 'Amount', money: 1 }, { key: 'refunded_amount', label: 'Refunded', money: 1 }, { key: 'reference_no', label: 'Reference' }, { key: 'provider_payment_id', label: 'Gateway ID' }], rows };
  },
  outstanding: async () => {
    const rows = await LIVE(db('orders as o')).join('users as u', 'u.id', 'o.user_id').andWhereRaw('o.amount_paid < o.grand_total')
      .select('o.order_number', 'u.name', 'u.phone', 'o.buyer_tier', 'o.payment_method', 'o.due_date', 'o.grand_total', 'o.amount_paid', db.raw('o.grand_total - o.amount_paid as due'))
      .orderBy('o.due_date');
    return { title: 'Outstanding balances', columns: [{ key: 'order_number', label: 'Order' }, { key: 'name', label: 'Buyer' }, { key: 'phone', label: 'Phone' }, { key: 'buyer_tier', label: 'Type' }, { key: 'payment_method', label: 'Method' }, { key: 'due_date', label: 'Due date' }, { key: 'grand_total', label: 'Total', money: 1 }, { key: 'amount_paid', label: 'Paid', money: 1 }, { key: 'due', label: 'Due', money: 1 }], rows };
  },
  delivery: async ({ from, to }) => {
    const rows = await range(db('delivery_assignments as da').join('delivery_staff as ds', 'ds.id', 'da.staff_id').join('users as u', 'u.id', 'ds.user_id'), from, to, "datetime(da.created_at, '+330 minutes')")
      .select('u.name').count({ assigned: '*' })
      .sum({ delivered: db.raw("CASE WHEN da.status='delivered' THEN 1 ELSE 0 END"), failed: db.raw("CASE WHEN da.status='failed' THEN 1 ELSE 0 END"), cash: 'da.cash_collected', jars: 'da.empty_jars_collected' })
      .groupBy('u.name');
    return { title: 'Delivery performance', columns: [{ key: 'name', label: 'Staff' }, { key: 'assigned', label: 'Assigned' }, { key: 'delivered', label: 'Delivered' }, { key: 'failed', label: 'Failed' }, { key: 'cash', label: 'Cash collected', money: 1 }, { key: 'jars', label: 'Empty jars' }], rows };
  },
  inventory: async () => {
    const rows = await db('inventory as i').join('products as p', 'p.id', 'i.product_id')
      .select('p.sku', 'p.name', 'i.quantity_available', 'i.quantity_reserved', 'i.quantity_damaged', 'i.low_stock_threshold',
        db.raw("(SELECT MIN(expiry_date) FROM inventory_batches b WHERE b.product_id = p.id AND b.status='active' AND b.quantity_remaining > 0) as next_expiry"))
      .orderBy('p.name');
    return { title: 'Inventory', columns: [{ key: 'sku', label: 'SKU' }, { key: 'name', label: 'Product' }, { key: 'quantity_available', label: 'Available' }, { key: 'quantity_reserved', label: 'Reserved' }, { key: 'quantity_damaged', label: 'Damaged' }, { key: 'low_stock_threshold', label: 'Low-stock at' }, { key: 'next_expiry', label: 'Next expiry' }], rows };
  },
  jars: async () => {
    const rows = await db('jar_balances as j').join('users as u', 'u.id', 'j.user_id').join('roles as r', 'r.id', 'u.role_id')
      .select('u.name', 'u.phone', 'r.name as type', 'j.jars_delivered', 'j.jars_returned', 'j.jars_pending', 'j.deposit_held').orderBy('j.jars_pending', 'desc');
    return { title: 'Empty jar balances', columns: [{ key: 'name', label: 'Holder' }, { key: 'phone', label: 'Phone' }, { key: 'type', label: 'Type' }, { key: 'jars_delivered', label: 'Delivered' }, { key: 'jars_returned', label: 'Returned' }, { key: 'jars_pending', label: 'Pending' }, { key: 'deposit_held', label: 'Deposit', money: 1 }], rows };
  },
  profit: async ({ from, to }) => {
    // Estimate: revenue (ex-GST) minus per-unit production cost (product setting `unit_cost`) per SKU.
    const settings = require('./settings.service');
    const costs = await settings.get('unit_costs', {});
    const rows = (await REPORTS.products({ from, to })).rows.map((r) => {
      const cost = (costs[r.sku] || 0) * r.quantity;
      return { ...r, cost, profit: r.taxable - cost, margin: r.taxable ? `${Math.round(((r.taxable - cost) / r.taxable) * 100)}%` : '—' };
    });
    return { title: 'Profit estimate (ex-GST, using unit costs from Settings)', columns: [{ key: 'name', label: 'Product' }, { key: 'quantity', label: 'Qty' }, { key: 'taxable', label: 'Net revenue', money: 1 }, { key: 'cost', label: 'Est. cost', money: 1 }, { key: 'profit', label: 'Est. profit', money: 1 }, { key: 'margin', label: 'Margin' }], rows };
  },
};

async function exportXlsx(report, res) {
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet(report.title.slice(0, 31));
  ws.columns = report.columns.map((c) => ({ header: c.label, key: c.key, width: Math.max(12, c.label.length + 4), style: c.money ? { numFmt: '"₹"#,##0.00' } : {} }));
  ws.getRow(1).font = { bold: true, color: { argb: 'FF0E7490' } };
  report.rows.forEach((r) => ws.addRow(Object.fromEntries(report.columns.map((c) => [c.key, c.money ? (r[c.key] || 0) / 100 : r[c.key]]))));
  ws.views = [{ state: 'frozen', ySplit: 1 }];
  await wb.xlsx.write(res);
}

function exportPdf(report, res, meta = '') {
  const doc = new PDFDocument({ size: 'A4', layout: report.columns.length > 6 ? 'landscape' : 'portrait', margin: 30 });
  doc.pipe(res);
  doc.fontSize(16).fillColor('#0E7490').text(`IBT AQUA · ${report.title}`);
  doc.fontSize(8).fillColor('#64748B').text(meta).moveDown();
  const width = doc.page.width - 60;
  const w = width / report.columns.length;
  const row = (vals, bold) => {
    const y = doc.y;
    vals.forEach((v, i) => doc.fontSize(7.5).fillColor(bold ? '#0F172A' : '#334155').text(String(v ?? ''), 30 + i * w, y, { width: w - 4 }));
    doc.y = y + 14;
    if (doc.y > doc.page.height - 40) doc.addPage();
  };
  row(report.columns.map((c) => c.label), true);
  report.rows.forEach((r) => row(report.columns.map((c) => (c.money ? `Rs. ${((r[c.key] || 0) / 100).toFixed(2)}` : r[c.key]))));
  doc.end();
}

module.exports = { dashboard, REPORTS, exportXlsx, exportPdf };
