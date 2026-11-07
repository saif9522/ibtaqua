import { useEffect, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Download, FileSpreadsheet, FileText, Play, Pencil } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { api, errMsg, download, openBlob } from '../../services/api';
import { toast } from '../../redux/store';
import { PageHeader, Loading, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Tabs, Badge, Checkbox, Textarea, ErrorNote } from '../../components/ui';
import { inr, dateTime, date, humanize, toPaise, toRupees, TIER_LABEL, todayISO, ago } from '../../utils/format';

export function Payments() {
  const [sp, setSp] = useSearchParams();
  const status = sp.get('status') || '';
  const [page, setPage] = useState(1);
  const { data, reload } = useApi(`/admin/payments?page=${page}&limit=30${status ? `&status=${status}` : ''}`);
  const recon = useApi(status === 'recon' ? '/admin/payments-reconciliation' : null);
  const [verify, setVerify] = useState(null);
  const [refund, setRefund] = useState(null);
  const [settle, setSettle] = useState(sp.get('settle') ? { userId: sp.get('settle'), amount: '', method: 'bank_transfer', referenceNo: '' } : null);
  const [note, setNote] = useState('');
  const [run, busy] = useAction();
  const go = (fn, msg) => run(async () => { try { await fn(); toast(msg); setVerify(null); setRefund(null); setSettle(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  return (
    <>
      <PageHeader title="Payments" sub={data && !data.gatewayLive ? 'Razorpay keys are not set: online payments run in development mock mode.' : undefined}>
        <button className="btn-outline" onClick={() => setSettle({ userId: '', amount: '', method: 'bank_transfer', referenceNo: '' })}>Record B2B credit payment</button>
      </PageHeader>
      <Tabs tabs={[{ value: '', label: 'All' }, { value: 'pending_verification', label: 'To verify' }, 'captured', 'failed', 'refunded', { value: 'recon', label: 'Reconciliation' }]} value={status} onChange={(v) => { if (v) sp.set('status', v); else sp.delete('status'); setSp(sp); setPage(1); }} />
      {status === 'recon' ? (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="panel"><h2 className="px-5 pt-4 text-lg">Gateway attempts not completed</h2><p className="px-5 text-sm text-ink-soft">Created more than 30 minutes ago with no success or failure. Check them in the Razorpay dashboard.</p>{recon.data && <DataTable rows={recon.data.staleAttempts} empty="All clear" columns={[{ key: 'provider_order_id', label: 'Gateway order' }, { key: 'order_id', label: 'Order', render: (r) => <Link className="link" to={`/admin/orders/${r.order_id}`}>#{r.order_id}</Link> }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) }, { key: 'created_at', label: 'Created', render: (r) => ago(r.created_at) }]} />}</div>
          <div className="panel"><h2 className="px-5 pt-4 text-lg">Orders whose paid amount doesn't match payments</h2><p className="px-5 text-sm text-ink-soft">Excludes credit orders, which are settled in bulk.</p>{recon.data && <DataTable rows={recon.data.mismatchedOrders} empty="All clear" columns={[{ key: 'order_number', label: 'Order', render: (r) => <Link className="link" to={`/admin/orders/${r.id}`}>{r.order_number}</Link> }, { key: 'amount_paid', label: 'Order says', render: (r) => inr(r.amount_paid) }, { key: 'payments_net', label: 'Payments net', render: (r) => inr(r.payments_net) }]} />}</div>
        </div>
      ) : (
        <div className="panel">
          {!data && <Loading />}
          {data && <DataTable rows={data.data} empty="No payments" columns={[
            { key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) },
            { key: 'order_number', label: 'Order', render: (r) => (r.order_id ? <Link className="link" to={`/admin/orders/${r.order_id}`}>{r.order_number}</Link> : <Badge tone="aqua">Credit settlement</Badge>) },
            { key: 'payer', label: 'Payer', render: (r) => <>{r.payer}<p className="text-[12px] text-ink-soft">{r.phone}</p></> },
            { key: 'method', label: 'Method', render: (r) => humanize(r.method) }, { key: 'ref', label: 'Reference', render: (r) => <span className="font-mono text-[12.5px]">{r.reference_no || r.provider_payment_id || '—'}</span> },
            { key: 'amount', label: 'Amount', render: (r) => <><b>{inr(r.amount)}</b>{r.refunded_amount > 0 && <p className="text-[12px] text-ink-soft">refunded {inr(r.refunded_amount)}</p>}</> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'a', label: '', render: (r) => (r.status === 'pending_verification' ? <button className="btn-primary btn-sm" onClick={() => { setNote(''); setVerify(r); }}>Verify</button> : ['captured', 'partially_refunded'].includes(r.status) && r.method !== 'credit_settlement' ? <button className="btn-ghost btn-sm" onClick={() => setRefund({ ...r, value: toRupees(r.amount - r.refunded_amount), reason: '' })}>Refund</button> : null) },
          ]} />}
          {data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}
        </div>
      )}
      <Modal open={!!verify} onClose={() => setVerify(null)} title="Verify bank transfer" footer={verify && <>
        <Button variant="outline" busy={busy} onClick={() => go(() => api.post(`/admin/payments/${verify.id}/verify`, { approve: false, note: note || 'Not received' }), 'Payment rejected')}>Not received</Button>
        <Button busy={busy} onClick={() => go(() => api.post(`/admin/payments/${verify.id}/verify`, { approve: true }), 'Payment verified')}>Received, mark paid</Button>
      </>}>
        {verify && <div className="space-y-3 text-sm"><p>Check your bank statement for <b>{inr(verify.amount)}</b> with reference <b className="font-mono">{verify.reference_no}</b> from {verify.payer}.</p><Input label="Note if rejecting" value={note} onChange={(e) => setNote(e.target.value)} /></div>}
      </Modal>
      <Modal open={!!refund} onClose={() => setRefund(null)} title="Refund payment" footer={refund && <Button variant="danger" busy={busy} onClick={() => go(() => api.post(`/admin/payments/${refund.id}/refund`, { amount: toPaise(refund.value), reason: refund.reason }), 'Refund recorded')}>Refund {refund.value ? `₹${refund.value}` : ''}</Button>}>
        {refund && <div className="space-y-3"><Input label="Amount (₹)" type="number" step="0.01" value={refund.value} onChange={(e) => setRefund({ ...refund, value: e.target.value })} /><Input label="Reason" value={refund.reason} onChange={(e) => setRefund({ ...refund, reason: e.target.value })} /><p className="text-[13px] text-ink-soft">{refund.method === 'razorpay' && data?.gatewayLive ? 'The refund is sent through Razorpay.' : 'Record this after you return the money by cash, UPI or bank transfer.'}</p></div>}
      </Modal>
      <SettleModal value={settle} setValue={setSettle} busy={busy} onSave={() => go(() => api.post('/admin/payments/credit-settlement', { userId: Number(settle.userId), amount: toPaise(settle.amount), method: settle.method, referenceNo: settle.referenceNo || undefined }), 'Payment applied to oldest dues first')} />
    </>
  );
}

function SettleModal({ value, setValue, busy, onSave }) {
  const [partners, setPartners] = useState([]);
  useEffect(() => {
    if (!value) return;
    Promise.all(['retailer', 'wholesaler', 'distributor'].map((r) => api.get(`/admin/users?role=${r}&status=active&limit=100`))).then((rs) => setPartners(rs.flatMap((r) => r.data.data).filter((p) => p.outstanding > 0)));
  }, [!!value]); // eslint-disable-line react-hooks/exhaustive-deps
  if (!value) return null;
  const p = partners.find((x) => String(x.id) === String(value.userId));
  return (
    <Modal open onClose={() => setValue(null)} title="Record a credit payment" footer={<Button busy={busy} disabled={!value.userId || !value.amount} onClick={onSave}>Apply payment</Button>}>
      <div className="grid gap-3">
        <Select label="Partner" placeholder="Choose" value={value.userId} onChange={(e) => setValue({ ...value, userId: e.target.value })} options={partners.map((x) => ({ value: x.id, label: `${x.business_name} · due ${inr(x.outstanding)}` }))} />
        {p && <p className="text-sm text-ink-soft">Outstanding {inr(p.outstanding)}. The amount is applied to the oldest unpaid orders first.</p>}
        <Input label="Amount (₹)" type="number" step="0.01" value={value.amount} onChange={(e) => setValue({ ...value, amount: e.target.value })} />
        <Select label="Received by" value={value.method} onChange={(e) => setValue({ ...value, method: e.target.value })} options={[{ value: 'bank_transfer', label: 'Bank transfer' }, { value: 'upi', label: 'UPI' }, { value: 'cash', label: 'Cash' }, { value: 'cheque', label: 'Cheque' }]} />
        <Input label="Reference (UTR, cheque no.)" value={value.referenceNo} onChange={(e) => setValue({ ...value, referenceNo: e.target.value })} />
      </div>
    </Modal>
  );
}

export function Invoices() {
  const [f, setF] = useState({ from: '', to: '', search: '' });
  const [page, setPage] = useState(1);
  const { data } = useApi(`/admin/invoices?page=${page}&limit=30&${new URLSearchParams(Object.fromEntries(Object.entries(f).filter(([, v]) => v)))}`);
  return (
    <>
      <PageHeader title="Invoices" sub="GST invoices are numbered per financial year and issued when an order is dispatched.">
        <button className="btn-outline" onClick={() => download(`/admin/reports/gst?format=xlsx${f.from ? `&from=${f.from}` : ''}${f.to ? `&to=${f.to}` : ''}`, `gst-register-${todayISO()}.xlsx`)}><FileSpreadsheet className="size-4" />GST register</button>
      </PageHeader>
      <div className="mb-3 flex flex-wrap gap-2"><input className="input w-64" placeholder="Invoice no. or buyer" aria-label="Search" value={f.search} onChange={(e) => setF({ ...f, search: e.target.value })} /><input type="date" className="input w-auto" aria-label="From" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><input type="date" className="input w-auto" aria-label="To" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></div>
      <div className="panel">{data && <DataTable rows={data.data} columns={[
        { key: 'invoice_number', label: 'Invoice', render: (r) => <b className="font-mono">{r.invoice_number}</b> }, { key: 'invoice_date', label: 'Date', render: (r) => date(r.invoice_date) },
        { key: 'buyer_name', label: 'Buyer', render: (r) => <>{r.buyer_name}<p className="font-mono text-[12px] text-ink-soft">{r.buyer_gstin || 'Unregistered'}</p></> },
        { key: 'order_number', label: 'Order', render: (r) => <Link className="link" to={`/admin/orders/${r.order_id}`}>{r.order_number}</Link> },
        { key: 'taxable_value', label: 'Taxable', render: (r) => inr(r.taxable_value) }, { key: 'tax', label: 'Tax', render: (r) => (r.is_interstate ? `IGST ${inr(r.igst)}` : `CGST+SGST ${inr(r.cgst + r.sgst)}`) },
        { key: 'total', label: 'Total', render: (r) => <b>{inr(r.total)}</b> }, { key: 'order_status', label: 'Order', render: (r) => <StatusBadge status={r.order_status} /> },
        { key: 'pdf', label: '', render: (r) => <button className="btn-ghost btn-sm" onClick={() => openBlob(`/admin/orders/${r.order_id}/invoice.pdf`)}><FileText className="size-4" />PDF</button> },
      ]} />}{data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}</div>
    </>
  );
}

const EMPTY_COUPON = { code: '', description: '', discountType: 'percent', value: '', maxDiscount: '', minOrderValue: '', applicableTiers: ['customer'], usageLimit: '', perUserLimit: 1, validFrom: '', validTo: '', isActive: true };
export function Coupons() {
  const { data, reload } = useApi('/admin/coupons');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const open = (c) => setEdit(c ? { id: c.id, code: c.code, description: c.description || '', discountType: c.discount_type, value: c.discount_type === 'flat' ? toRupees(c.value) : c.value, maxDiscount: toRupees(c.max_discount), minOrderValue: toRupees(c.min_order_value), applicableTiers: c.applicable_tiers, usageLimit: c.usage_limit || '', perUserLimit: c.per_user_limit, validFrom: c.valid_from?.slice(0, 10) || '', validTo: c.valid_to?.slice(0, 10) || '', isActive: !!c.is_active } : { ...EMPTY_COUPON });
  const save = () => run(async () => {
    const e = edit;
    const body = { code: e.code, description: e.description, discountType: e.discountType, value: e.discountType === 'flat' ? toPaise(e.value) : Number(e.value), maxDiscount: e.maxDiscount ? toPaise(e.maxDiscount) : null, minOrderValue: toPaise(e.minOrderValue), applicableTiers: e.applicableTiers, usageLimit: e.usageLimit ? Number(e.usageLimit) : null, perUserLimit: Number(e.perUserLimit || 1), validFrom: e.validFrom ? `${e.validFrom} 00:00:00` : null, validTo: e.validTo ? `${e.validTo} 23:59:59` : null, isActive: e.isActive };
    try { if (e.id) await api.put(`/admin/coupons/${e.id}`, body); else await api.post('/admin/coupons', body); toast('Coupon saved'); setEdit(null); reload(); } catch (er) { toast(errMsg(er), 'danger'); }
  });
  return (
    <>
      <PageHeader title="Coupons"><button className="btn-primary" onClick={() => open(null)}><Plus className="size-4" />New coupon</button></PageHeader>
      <div className="panel">{data && <DataTable rows={data} onRowClick={open} columns={[
        { key: 'code', label: 'Code', render: (r) => <b className="font-mono">{r.code}</b> }, { key: 'description', label: 'Description' },
        { key: 'value', label: 'Discount', render: (r) => (r.discount_type === 'percent' ? `${r.value}%${r.max_discount ? ` up to ${inr(r.max_discount)}` : ''}` : inr(r.value)) },
        { key: 'min_order_value', label: 'Min order', render: (r) => inr(r.min_order_value) }, { key: 'tiers', label: 'For', render: (r) => r.applicable_tiers.map((t) => TIER_LABEL[t]).join(', ') },
        { key: 'used', label: 'Used', render: (r) => `${r.used_count}${r.usage_limit ? ` / ${r.usage_limit}` : ''}` }, { key: 'valid_to', label: 'Ends', render: (r) => (r.valid_to ? date(r.valid_to) : 'No end') },
        { key: 'is_active', label: 'Status', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
      ]} />}</div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit coupon' : 'New coupon'} footer={<>{edit?.id && <Button variant="ghost" onClick={() => window.confirm('Delete or deactivate this coupon?') && api.delete(`/admin/coupons/${edit.id}`).then(() => { setEdit(null); reload(); })}>Delete</Button>}<Button busy={busy} onClick={save}>Save coupon</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Code" value={edit.code} onChange={(e) => setEdit({ ...edit, code: e.target.value.toUpperCase() })} />
          <Select label="Type" value={edit.discountType} onChange={(e) => setEdit({ ...edit, discountType: e.target.value })} options={[{ value: 'percent', label: 'Percent off' }, { value: 'flat', label: 'Flat ₹ off' }]} />
          <Input className="sm:col-span-2" label="Description shown to buyers" value={edit.description} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <Input label={edit.discountType === 'percent' ? 'Percent' : 'Amount (₹)'} type="number" value={edit.value} onChange={(e) => setEdit({ ...edit, value: e.target.value })} />
          {edit.discountType === 'percent' && <Input label="Max discount (₹)" type="number" value={edit.maxDiscount} onChange={(e) => setEdit({ ...edit, maxDiscount: e.target.value })} />}
          <Input label="Minimum order (₹)" type="number" value={edit.minOrderValue} onChange={(e) => setEdit({ ...edit, minOrderValue: e.target.value })} />
          <Input label="Total uses allowed" type="number" placeholder="Unlimited" value={edit.usageLimit} onChange={(e) => setEdit({ ...edit, usageLimit: e.target.value })} />
          <Input label="Uses per buyer" type="number" value={edit.perUserLimit} onChange={(e) => setEdit({ ...edit, perUserLimit: e.target.value })} />
          <Input label="Starts" type="date" value={edit.validFrom} onChange={(e) => setEdit({ ...edit, validFrom: e.target.value })} />
          <Input label="Ends" type="date" value={edit.validTo} onChange={(e) => setEdit({ ...edit, validTo: e.target.value })} />
          <div className="sm:col-span-2"><p className="label">Who can use it</p><div className="flex flex-wrap gap-4">{Object.entries(TIER_LABEL).map(([t, l]) => <Checkbox key={t} label={l} checked={edit.applicableTiers.includes(t)} onChange={(e) => setEdit({ ...edit, applicableTiers: e.target.checked ? [...edit.applicableTiers, t] : edit.applicableTiers.filter((x) => x !== t) })} />)}</div></div>
          <Checkbox label="Active" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
        </div>}
      </Modal>
    </>
  );
}

const REPORTS = [
  ['sales', 'Sales', true], ['buyers', 'Purchases by buyer', true], ['products', 'Product-wise sales', true], ['gst', 'GST register', true], ['payments', 'Payments', true],
  ['outstanding', 'Outstanding balances', false], ['delivery', 'Delivery performance', true], ['inventory', 'Inventory', false], ['jars', 'Empty jars', false], ['profit', 'Profit estimate', true],
];
export function Reports() {
  const [name, setName] = useState('sales');
  const [f, setF] = useState({ from: `${todayISO().slice(0, 7)}-01`, to: todayISO(), group: 'day', tier: '' });
  const meta = REPORTS.find((r) => r[0] === name);
  const qs = new URLSearchParams({ ...(meta[2] && { from: f.from, to: f.to }), ...(name === 'sales' && { group: f.group }), ...(name === 'buyers' && f.tier && { tier: f.tier }) }).toString();
  const { data, loading, error } = useApi(`/admin/reports/${name}?${qs}`);
  const totals = data?.columns.filter((c) => c.money || ['orders', 'quantity', 'delivered', 'assigned', 'failed'].includes(c.key)).map((c) => [c, data.rows.reduce((s, r) => s + (Number(r[c.key]) || 0), 0)]);
  return (
    <>
      <PageHeader title="Reports">
        <button className="btn-outline" onClick={() => download(`/admin/reports/${name}?${qs}&format=xlsx`, `ibt-${name}-${todayISO()}.xlsx`)}><FileSpreadsheet className="size-4" />Excel</button>
        <button className="btn-outline" onClick={() => download(`/admin/reports/${name}?${qs}&format=pdf`, `ibt-${name}-${todayISO()}.pdf`)}><Download className="size-4" />PDF</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap items-end gap-3">
        <Select label="Report" value={name} onChange={(e) => setName(e.target.value)} options={REPORTS.map(([v, l]) => ({ value: v, label: l }))} />
        {meta[2] && <><Input label="From" type="date" value={f.from} onChange={(e) => setF({ ...f, from: e.target.value })} /><Input label="To" type="date" value={f.to} onChange={(e) => setF({ ...f, to: e.target.value })} /></>}
        {name === 'sales' && <Select label="Group by" value={f.group} onChange={(e) => setF({ ...f, group: e.target.value })} options={['day', 'month', 'year']} />}
        {name === 'buyers' && <Select label="Buyer type" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} options={[{ value: '', label: 'All' }, ...Object.entries(TIER_LABEL).map(([v, l]) => ({ value: v, label: l }))]} />}
      </div>
      {name === 'profit' && <p className="mb-3 text-sm text-ink-soft">Uses the per-unit production costs saved in Settings → unit_costs. Products without a cost show full revenue as profit.</p>}
      <div className="panel">
        {loading && <Loading />}<ErrorNote>{error}</ErrorNote>
        {data && <DataTable rows={data.rows} rowKey="__i" empty="No data for this period" columns={data.columns.map((c) => ({ key: c.key, label: c.label, render: (r) => (c.money ? inr(r[c.key] || 0) : r[c.key] ?? '—') }))} />}
        {!!data?.rows.length && <div className="flex flex-wrap gap-x-6 gap-y-1 border-t border-shoal px-4 py-3 text-sm">{totals.map(([c, v]) => <span key={c.key}><span className="text-ink-soft">{c.label}:</span> <b>{c.money ? inr(v) : v}</b></span>)}</div>}
      </div>
    </>
  );
}

export function Subscriptions() {
  const [status, setStatus] = useState('active');
  const { data, reload } = useApi(`/admin/subscriptions${status ? `?status=${status}` : ''}`);
  const [run, busy] = useAction();
  const act = (id, a) => run(async () => { try { await api.post(`/admin/subscriptions/${id}/${a}`, {}); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  return (
    <>
      <PageHeader title="Subscriptions" sub="Orders are generated automatically each morning for deliveries due tomorrow.">
        <Button variant="outline" busy={busy} onClick={() => run(async () => { const r = await api.post('/admin/subscriptions-run', {}); toast(`Created ${r.data.created}, failed ${r.data.failed}, already done ${r.data.skipped}`); reload(); })}><Play className="size-4" />Generate due orders now</Button>
      </PageHeader>
      <Tabs tabs={['active', 'paused', 'cancelled', { value: '', label: 'All' }]} value={status} onChange={setStatus} />
      <div className="panel">{data && <DataTable rows={data} empty="No subscriptions" columns={[
        { key: 'name', label: 'Buyer', render: (r) => <Link className="link" to={`/admin/users/${r.user_id}`}>{r.name}</Link> }, { key: 'product', label: 'Product', render: (r) => `${r.quantity} × ${r.product_name}` },
        { key: 'frequency', label: 'Schedule', render: (r) => (r.frequency === 'custom' ? JSON.parse(r.custom_weekdays || '[]').map((d) => ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d]).join(', ') : humanize(r.frequency)) },
        { key: 'next_run_date', label: 'Next', render: (r) => (r.next_run_date ? date(r.next_run_date) : '—') }, { key: 'payment_method', label: 'Pay', render: (r) => humanize(r.payment_method) },
        { key: 'orders', label: 'Orders', render: (r) => <>{r.orders_created}{r.orders_failed ? <span className="text-danger"> ({r.orders_failed} failed)</span> : ''}</> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'a', label: '', render: (r) => <span className="flex gap-1">{r.status === 'active' && <button className="btn-ghost btn-sm" onClick={() => act(r.id, 'pause')}>Pause</button>}{r.status === 'paused' && <button className="btn-ghost btn-sm" onClick={() => act(r.id, 'resume')}>Resume</button>}{r.status !== 'cancelled' && <button className="btn-ghost btn-sm" onClick={() => window.confirm('Cancel subscription?') && act(r.id, 'cancel')}>Cancel</button>}</span> },
      ]} />}</div>
    </>
  );
}

export function Zones() {
  const { data, reload } = useApi('/admin/zones');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const save = () => run(async () => {
    const body = { name: edit.name, pincodes: edit.pincodes.split(/[\s,]+/).filter(Boolean), deliveryCharge: toPaise(edit.deliveryCharge), freeDeliveryAbove: edit.freeDeliveryAbove ? toPaise(edit.freeDeliveryAbove) : null, minOrderValue: toPaise(edit.minOrderValue), isActive: edit.isActive };
    try { if (edit.id) await api.put(`/admin/zones/${edit.id}`, body); else await api.post('/admin/zones', body); toast('Zone saved'); setEdit(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); }
  });
  return (
    <>
      <PageHeader title="Delivery zones" sub="A pincode belongs to one zone. Orders outside every zone are refused at checkout."><button className="btn-primary" onClick={() => setEdit({ name: '', pincodes: '', deliveryCharge: 0, freeDeliveryAbove: '', minOrderValue: 0, isActive: true })}><Plus className="size-4" />Add zone</button></PageHeader>
      <div className="panel">{data && <DataTable rows={data} onRowClick={(z) => setEdit({ id: z.id, name: z.name, pincodes: z.pincodes.join(', '), deliveryCharge: toRupees(z.delivery_charge), freeDeliveryAbove: toRupees(z.free_delivery_above), minOrderValue: toRupees(z.min_order_value), isActive: !!z.is_active })} columns={[
        { key: 'name', label: 'Zone', render: (r) => <b>{r.name}</b> }, { key: 'pincodes', label: 'Pincodes', render: (r) => <span className="line-clamp-2 max-w-md text-ink-soft">{r.pincodes.join(', ')}</span> },
        { key: 'delivery_charge', label: 'Delivery', render: (r) => inr(r.delivery_charge) }, { key: 'free_delivery_above', label: 'Free above', render: (r) => (r.free_delivery_above ? inr(r.free_delivery_above) : '—') },
        { key: 'min_order_value', label: 'Min order', render: (r) => inr(r.min_order_value) }, { key: 'staff_count', label: 'Staff' }, { key: 'is_active', label: 'Status', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
        { key: 'e', label: '', render: () => <Pencil className="size-4 text-ink-soft" /> },
      ]} />}</div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit zone' : 'New zone'} footer={<Button busy={busy} onClick={save}>Save zone</Button>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Input className="sm:col-span-2" label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Textarea className="sm:col-span-2" label="Pincodes" hint="Separate with commas or spaces" value={edit.pincodes} onChange={(e) => setEdit({ ...edit, pincodes: e.target.value })} />
          <Input label="Delivery charge (₹)" type="number" value={edit.deliveryCharge} onChange={(e) => setEdit({ ...edit, deliveryCharge: e.target.value })} />
          <Input label="Free delivery above (₹)" type="number" value={edit.freeDeliveryAbove} onChange={(e) => setEdit({ ...edit, freeDeliveryAbove: e.target.value })} />
          <Input label="Minimum order (₹, customers)" type="number" value={edit.minOrderValue} onChange={(e) => setEdit({ ...edit, minOrderValue: e.target.value })} />
          <Checkbox label="Active" checked={edit.isActive} onChange={(e) => setEdit({ ...edit, isActive: e.target.checked })} />
        </div>}
      </Modal>
    </>
  );
}

export function DeliveryBoard() {
  const [d, setD] = useState(todayISO());
  const { data, reload } = useApi(`/admin/delivery/board?date=${d}`, { poll: 30000 });
  return (
    <>
      <PageHeader title="Delivery board" sub="Live runs per delivery partner. Assign orders from the Orders page.">
        <Link to="/admin/orders?unassigned=true&status=ready_for_dispatch" className="btn-primary">Orders waiting for a driver</Link>
        <Input type="date" aria-label="Date" value={d} onChange={(e) => setD(e.target.value)} />
      </PageHeader>
      {!data && <Loading />}
      <div className="grid gap-5 lg:grid-cols-2">
        {data?.staff.map((s) => {
          const stops = data.active.filter((a) => a.staff_id === s.id);
          return (
            <section key={s.id} className="panel">
              <div className="flex flex-wrap items-center justify-between gap-2 border-b border-shoal px-5 py-3">
                <div><p className="font-semibold text-depth">{s.name} {!s.is_available && <Badge tone="warn">Unavailable</Badge>}</p><p className="text-[12.5px] text-ink-soft">{s.zone_name || 'All zones'} · {s.vehicle_number} · <a className="link" href={`tel:+91${s.phone}`}>{s.phone}</a></p></div>
                <p className="text-sm text-ink-soft">{s.report.delivered} delivered · {s.report.failed} failed · {inr(s.report.cashCollected)} cash · {s.report.emptyJarsCollected} jars</p>
              </div>
              {stops.length ? (
                <ol className="divide-y divide-shoal/70">{stops.map((a) => (
                  <li key={a.id} className="flex items-center gap-3 px-5 py-2.5 text-sm">
                    <input className="input w-14 py-1 text-center" type="number" min={1} aria-label="Route position" defaultValue={a.route_sequence} onBlur={(e) => Number(e.target.value) !== a.route_sequence && api.post(`/admin/delivery/assignments/${a.id}/sequence`, { sequence: Number(e.target.value) }).then(reload)} />
                    <div className="flex-1"><Link className="link" to={`/admin/orders/${a.order_id}`}>{a.order_number}</Link> · {a.customer}<p className="text-[12px] text-ink-soft">{a.address?.line1}, {a.address?.pincode} · {a.delivery_slot}</p></div>
                    <StatusBadge status={a.status} />
                  </li>
                ))}</ol>
              ) : <p className="px-5 py-6 text-sm text-ink-soft">No active stops.</p>}
            </section>
          );
        })}
      </div>
    </>
  );
}
