/**
 * GST tax invoices. Numbers are sequential per Indian financial year (Apr–Mar), as GST rules require.
 * PDFs are rendered on demand from stored data, so business details edited in Settings apply.
 */
const PDFDocument = require('pdfkit');
const db = require('../database/db');
const settings = require('./settings.service');
const { parseJSON, todayIST, rupees } = require('../utils/helpers');
const { notFound } = require('../utils/errors');

const fyOf = (iso) => {
  const [y, m] = iso.split('-').map(Number);
  const start = m >= 4 ? y : y - 1;
  return `${String(start).slice(2)}-${String(start + 1).slice(2)}`;
};

async function ensureInvoice(trx, orderId) {
  const existing = await trx('invoices').where({ order_id: orderId }).first();
  if (existing) return existing;
  const o = await trx('orders').where({ id: orderId }).first();
  const buyer = await trx('users as u').join('roles as r', 'r.id', 'u.role_id').where('u.id', o.user_id).first('u.name', 'r.name as role');
  const biz = ['retailer', 'wholesaler', 'distributor'].includes(buyer.role) ? await trx(`${buyer.role}s`).where({ user_id: o.user_id }).first() : null;
  const addr = parseJSON(o.address_snapshot, {});
  const sellerState = (await settings.get('business_profile', {})).state || 'Jharkhand';
  const interstate = (addr.state || sellerState).toLowerCase() !== sellerState.toLowerCase();
  const date = todayIST();
  const fy = fyOf(date);
  const prefix = await settings.get('invoice_prefix', 'IBT');
  const like = `${prefix}/${fy}/%`;
  const last = await trx('invoices').where('invoice_number', 'like', like).orderBy('id', 'desc').first('invoice_number');
  const seq = last ? Number(last.invoice_number.split('/').pop()) + 1 : 1;
  const half = Math.floor(o.gst_total / 2);
  const row = {
    order_id: orderId, invoice_number: `${prefix}/${fy}/${String(seq).padStart(5, '0')}`, invoice_date: date,
    buyer_name: biz?.business_name || buyer.name, buyer_gstin: biz?.gstin || null, place_of_supply: addr.state || sellerState,
    is_interstate: interstate, taxable_value: o.taxable_total,
    cgst: interstate ? 0 : half, sgst: interstate ? 0 : o.gst_total - half, igst: interstate ? o.gst_total : 0,
    total: o.grand_total,
  };
  await trx('invoices').insert(row);
  return trx('invoices').where({ order_id: orderId }).first();
}

async function renderPdf(orderId, stream) {
  const inv = await db('invoices').where({ order_id: orderId }).first();
  if (!inv) throw notFound('Invoice');
  const o = await db('orders').where({ id: orderId }).first();
  const items = await db('order_items').where({ order_id: orderId });
  const seller = await settings.get('business_profile', {});
  const addr = parseJSON(o.address_snapshot, {});
  const doc = new PDFDocument({ size: 'A4', margin: 40 });
  doc.pipe(stream);
  // pdfkit's core fonts lack ₹, so amounts use "Rs."
  const money = (p) => rupees(p).replace('₹', 'Rs. ');

  doc.fillColor('#0E7490').fontSize(20).text(seller.brand_name || 'IBT AQUA', 40, 40);
  doc.fillColor('#334155').fontSize(9)
    .text(seller.legal_name || 'IBT ENTERPRISES')
    .text([seller.address, seller.city, seller.state, seller.pincode].filter(Boolean).join(', '))
    .text(`GSTIN: ${seller.gstin || '—'}   FSSAI: ${seller.fssai || '—'}   BIS: ${seller.bis_license || '—'}`)
    .text(`Phone: ${seller.phone || '—'}   Email: ${seller.email || '—'}`);
  doc.fillColor('#0F172A').fontSize(14).text('TAX INVOICE', 400, 40, { align: 'right' });
  doc.fontSize(9).text(`Invoice: ${inv.invoice_number}`, 400, 62, { align: 'right' })
    .text(`Date: ${inv.invoice_date}`, { align: 'right' }).text(`Order: ${o.order_number}`, { align: 'right' });

  doc.moveTo(40, 120).lineTo(555, 120).strokeColor('#BAE6FD').stroke();
  doc.fontSize(10).fillColor('#0F172A').text('Bill to', 40, 130);
  doc.fontSize(9).fillColor('#334155').text(inv.buyer_name)
    .text([addr.line1, addr.line2, addr.city, addr.state, addr.pincode].filter(Boolean).join(', '), { width: 300 })
    .text(`GSTIN: ${inv.buyer_gstin || 'Unregistered'}   Place of supply: ${inv.place_of_supply}`);

  let y = 200;
  const cols = [40, 220, 270, 330, 395, 455, 505];
  const head = ['Item', 'Qty', 'Rate', 'Taxable', 'GST %', 'GST', 'Total'];
  doc.rect(40, y - 4, 515, 18).fill('#ECFEFF');
  doc.fillColor('#0F172A').fontSize(9);
  head.forEach((h, i) => doc.text(h, cols[i], y, { width: i ? 55 : 175 }));
  y += 20;
  doc.fillColor('#334155');
  for (const it of items) {
    const row = [`${it.product_name} (${it.sku})`, String(it.quantity), money(it.unit_price), money(it.taxable_amount), `${it.gst_percent}%`, money(it.gst_amount), money(it.line_total)];
    row.forEach((c, i) => doc.text(c, cols[i], y, { width: i ? 55 : 175 }));
    y += 18;
    if (y > 700) { doc.addPage(); y = 50; }
  }
  y += 10;
  const totals = [
    ['Taxable value', inv.taxable_value],
    ...(inv.is_interstate ? [['IGST', inv.igst]] : [['CGST', inv.cgst], ['SGST', inv.sgst]]),
    ['Coupon discount (included above)', -o.discount_total],
    ['Delivery charge', o.delivery_charge],
    ['Jar deposit (refundable)', o.jar_deposit_total],
    ['Grand total', inv.total],
  ].filter(([, v]) => v !== 0 || ['Grand total', 'Taxable value'].includes(v));
  for (const [k, v] of totals) {
    doc.fontSize(k === 'Grand total' ? 11 : 9).fillColor('#0F172A').text(k, 330, y, { width: 120 }).text(money(v), 455, y, { width: 100, align: 'right' });
    y += 16;
  }
  doc.fontSize(8).fillColor('#64748B').text(`Payment: ${o.payment_method.toUpperCase()} · ${o.payment_status}`, 40, y + 20)
    .text('This is a computer-generated invoice.', 40, y + 34);
  doc.end();
}

module.exports = { ensureInvoice, renderPdf };
