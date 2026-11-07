import { useMemo, useRef, useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid } from 'recharts';
import { Upload, FileText, Phone, Clock } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useSite';
import { api, errMsg } from '../../services/api';
import { cartActions, toast, loadMe } from '../../redux/store';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Button, Modal, Input, Stat, Select, Empty, Badge } from '../../components/ui';
import { inr, date, dateTime, humanize, TIER_LABEL, imgUrl, todayISO, toPaise } from '../../utils/format';

export function BusinessHome() {
  const { user } = useAuth();
  const { data, loading, error, reload } = useApi('/account/business/summary');
  const orders = useApi('/account/orders?limit=6');
  const [credit, setCredit] = useState(false);
  const [f, setF] = useState({ amount: '', reason: '' });
  const [run, busy] = useAction();
  if (loading) return <Loading />;
  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  const c = data.credit;
  const chart = [...data.monthly].reverse().map((m) => ({ month: m.month, total: m.total / 100 }));
  const pending = data.creditRequests.find((r) => r.status === 'pending');
  return (
    <>
      <PageHeader title={data.business.business_name} sub={`${TIER_LABEL[user.tier]} account${data.business.gstin ? ` · GSTIN ${data.business.gstin}` : ''}`}>
        <Link to="/business/quick-order" className="btn-primary">Quick order</Link>
      </PageHeader>
      <div className="panel grid grid-cols-2 divide-x divide-y divide-shoal sm:grid-cols-4 sm:divide-y-0">
        <Stat label="Outstanding" value={inr(c.outstanding)} tone={c.overdue ? 'danger' : undefined} note={c.overdue ? `${inr(c.overdue)} overdue` : 'Nothing overdue'} />
        <Stat label="Credit available" value={c.enabled ? inr(c.available) : 'Not enabled'} note={c.enabled ? `of ${inr(c.limit)} · ${c.days} days` : undefined} />
        <Stat label="This month" value={inr(data.monthly.find((m) => m.month === todayISO().slice(0, 7))?.total || 0)} note={`${data.monthly.find((m) => m.month === todayISO().slice(0, 7))?.orders || 0} orders`} />
        <Stat label="Last 12 months" value={inr(data.monthly.reduce((s, m) => s + m.total, 0))} />
      </div>
      <div className="mt-6 grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="panel p-5">
          <h2 className="text-lg">Monthly purchases</h2>
          {chart.length ? (
            <div className="mt-3 h-56"><ResponsiveContainer><BarChart data={chart}><CartesianGrid vertical={false} stroke="#cfe6ee" /><XAxis dataKey="month" tick={{ fontSize: 12 }} /><YAxis tick={{ fontSize: 12 }} width={60} tickFormatter={(v) => `₹${v >= 1000 ? `${Math.round(v / 1000)}k` : v}`} /><Tooltip formatter={(v) => `₹${v.toLocaleString('en-IN')}`} /><Bar dataKey="total" fill="#0596B4" radius={[4, 4, 0, 0]} /></BarChart></ResponsiveContainer></div>
          ) : <Empty title="No purchases yet" />}
        </div>
        <div className="space-y-5">
          <div className="panel p-5 text-sm">
            <h2 className="text-lg">Credit</h2>
            {pending ? <p className="mt-2 flex items-center gap-2 text-ink-soft"><Clock className="size-4" />Request for {inr(pending.requested_limit)} is being reviewed.</p>
              : <button className="btn-outline btn-sm mt-3" onClick={() => setCredit(true)}>{c.enabled ? 'Request a higher limit' : 'Request credit'}</button>}
            {data.salesContact && <p className="mt-4 flex items-center gap-2"><Phone className="size-4 text-aqua" />Sales team <a className="link" href={`tel:+91${data.salesContact}`}>+91 {data.salesContact}</a></p>}
            {!!data.zones.length && <p className="mt-3">Your distribution areas: {data.zones.map((z) => <Badge key={z.id} tone="aqua" className="mr-1">{z.name}</Badge>)}</p>}
          </div>
          {!!data.offers.length && (
            <div className="panel p-5 text-sm"><h2 className="text-lg">Offers for you</h2><ul className="mt-2 space-y-2">{data.offers.map((o) => <li key={o.code}><b className="font-mono text-aqua-700">{o.code}</b> · {o.description}</li>)}</ul></div>
          )}
          {!!data.negotiatedPrices.length && (
            <div className="panel p-5 text-sm"><h2 className="text-lg">Your price agreements</h2><ul className="mt-2 space-y-1">{data.negotiatedPrices.map((n, i) => <li key={i} className="flex justify-between gap-2"><span>{n.name}</span><span className="font-semibold">{inr(n.price)}{n.valid_to ? ` till ${date(n.valid_to)}` : ''}</span></li>)}</ul></div>
          )}
        </div>
      </div>
      <h2 className="mb-3 mt-8 text-xl">Recent orders</h2>
      <div className="panel">{orders.data && <DataTable rows={orders.data.data} empty="No orders yet" columns={[
        { key: 'order_number', label: 'Order', render: (r) => <Link className="link" to={`/account/orders/${r.id}`}>{r.order_number}</Link> },
        { key: 'created_at', label: 'Date', render: (r) => date(r.created_at) }, { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total) },
        { key: 'payment_status', label: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />}</div>
      <Modal open={credit} onClose={() => setCredit(false)} title="Request a credit limit" footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/account/business/credit-request', { requestedLimit: toPaise(f.amount), reason: f.reason }); toast('Request sent to our team'); setCredit(false); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Send request</Button>}>
        <div className="space-y-3"><Input label="Limit you need (₹)" type="number" min={1} value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} /><Input label="Why (optional)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} /></div>
      </Modal>
    </>
  );
}

export function QuickOrder() {
  const { data, loading } = useApi('/products?limit=100');
  const [qty, setQty] = useState({});
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const rows = (data?.data || []).filter((p) => p.price);
  const total = useMemo(() => rows.reduce((s, p) => s + (qty[p.id] || 0) * p.price.unitPrice, 0), [rows, qty]);
  const invalid = rows.filter((p) => qty[p.id] > 0 && qty[p.id] < p.price.minOrderQty);
  const go = () => {
    dispatch(cartActions.replace(rows.filter((p) => qty[p.id] > 0).map((p) => ({ productId: p.id, quantity: qty[p.id], name: p.name, image: p.image, slug: p.slug, minQty: p.price.minOrderQty }))));
    navigate('/checkout');
  };
  if (loading) return <Loading />;
  return (
    <>
      <PageHeader title="Quick order" sub="Type quantities for everything you need, then check out once. Prices shown are your partner prices before quantity discounts." />
      <div className="panel overflow-x-auto">
        <table className="table-base">
          <thead><tr><th>Product</th><th>Your price</th><th>MRP</th><th>Minimum</th><th className="w-36">Quantity</th><th className="text-right">Amount</th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const q = qty[p.id] || 0;
              const bad = q > 0 && q < p.price.minOrderQty;
              return (
                <tr key={p.id}>
                  <td><div className="flex items-center gap-3"><img src={imgUrl(p.image)} alt="" className="size-10 rounded bg-mist" /><div><p className="font-semibold">{p.name}</p><p className="text-[12.5px] text-ink-soft">{p.sku}{!p.inStock && ' · out of stock'}</p></div></div></td>
                  <td className="font-semibold">{inr(p.price.unitPrice)}{p.price.source === 'negotiated' && <Badge tone="aqua" className="ml-1">Agreed</Badge>}</td>
                  <td className="text-ink-soft">{inr(p.mrp)}</td>
                  <td>{p.price.minOrderQty}</td>
                  <td><input type="number" min={0} aria-label={`Quantity of ${p.name}`} disabled={!p.inStock} className={`input py-1.5 ${bad ? 'input-error' : ''}`} value={q || ''} placeholder="0" onChange={(e) => setQty({ ...qty, [p.id]: Math.max(0, parseInt(e.target.value, 10) || 0) })} />{bad && <p className="mt-1 text-[12px] text-danger">Min {p.price.minOrderQty}</p>}</td>
                  <td className="text-right font-semibold">{q ? inr(q * p.price.unitPrice) : '—'}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sticky bottom-0 mt-4 flex items-center justify-between gap-4 rounded-[var(--radius-panel)] bg-depth px-5 py-4 text-white">
        <div><p className="text-sm text-[#cfe6ee]">Estimated total (incl. GST)</p><p className="font-display text-2xl font-bold">{inr(total)}</p></div>
        <button className="btn bg-white text-depth hover:bg-mist" disabled={!total || invalid.length > 0} onClick={go}>Review and check out</button>
      </div>
    </>
  );
}

export function Statement() {
  const [range, setRange] = useState({ from: `${todayISO().slice(0, 7)}-01`, to: todayISO() });
  const { data, loading } = useApi(`/account/business/statement?from=${range.from}&to=${range.to}`);
  const payments = useApi('/account/payments');
  return (
    <>
      <PageHeader title="Account statement" sub="Orders (debits) and payments (credits) with a running balance.">
        <button className="btn-outline" onClick={() => window.print()}>Print</button>
      </PageHeader>
      <div className="mb-4 flex flex-wrap gap-3">
        <Input label="From" type="date" value={range.from} onChange={(e) => setRange({ ...range, from: e.target.value })} />
        <Input label="To" type="date" value={range.to} onChange={(e) => setRange({ ...range, to: e.target.value })} />
      </div>
      <div className="panel">
        {loading && <Loading />}
        {data && <DataTable rows={data.rows} rowKey="ref" empty="No transactions in this period" columns={[
          { key: 'date', label: 'Date', render: (r) => dateTime(r.date) }, { key: 'type', label: 'Type' }, { key: 'ref', label: 'Reference' },
          { key: 'debit', label: 'Debit', className: 'text-right', render: (r) => (r.debit ? inr(r.debit) : '') }, { key: 'credit', label: 'Credit', className: 'text-right', render: (r) => (r.credit ? inr(r.credit) : '') },
          { key: 'balance', label: 'Balance', className: 'text-right font-semibold', render: (r) => inr(r.balance) },
        ]} />}
        {data && <p className="border-t border-shoal px-4 py-3 text-right text-sm">Period debits {inr(data.totals.debit)} · credits {inr(data.totals.credit)}</p>}
      </div>
      <h2 className="mb-3 mt-8 text-xl">Payment history</h2>
      <div className="panel">{payments.data && <DataTable rows={payments.data} empty="No payments" columns={[
        { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) }, { key: 'order_number', label: 'Order' }, { key: 'method', label: 'Method', render: (r) => humanize(r.method) },
        { key: 'reference_no', label: 'Reference' }, { key: 'amount', label: 'Amount', render: (r) => inr(r.amount) }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />}</div>
    </>
  );
}

export function Documents() {
  const { user } = useAuth();
  const dispatch = useDispatch();
  const { data, reload } = useApi('/auth/me/documents');
  const [type, setType] = useState('gst_certificate');
  const file = useRef();
  const [run, busy] = useAction();
  const upload = () => run(async () => {
    const f = file.current.files[0];
    if (!f) return toast('Choose a file first', 'danger');
    const fd = new FormData(); fd.append('file', f); fd.append('docType', type);
    try { await api.post('/auth/me/documents', fd); toast('Document uploaded'); file.current.value = ''; reload(); dispatch(loadMe()); } catch (e) { toast(errMsg(e), 'danger'); }
  });
  return (
    <>
      <PageHeader title="Business documents" />
      {user.status === 'pending' && (
        <div className="mb-5 rounded-[var(--radius-panel)] border border-marigold/40 bg-marigold-soft p-5">
          <p className="font-display text-lg font-bold text-[#7a540e]">Your account is waiting for approval</p>
          <p className="mt-1 text-sm text-[#7a540e]">Upload your GST certificate (and PAN or trade licence if you have them). We'll review and notify you by SMS. You can order as soon as you're approved.</p>
        </div>
      )}
      {user.status === 'rejected' && <ErrorNote>Your application was not approved: {user.business?.rejection_reason}. Contact us to reapply.</ErrorNote>}
      <div className="panel flex flex-wrap items-end gap-3 p-5">
        <Select label="Document" value={type} onChange={(e) => setType(e.target.value)} options={[{ value: 'gst_certificate', label: 'GST certificate' }, { value: 'pan', label: 'PAN card' }, { value: 'trade_license', label: 'Trade licence' }, { value: 'fssai', label: 'FSSAI licence' }, { value: 'shop_photo', label: 'Shop photo' }, { value: 'other', label: 'Other' }]} />
        <div><label className="label" htmlFor="doc">File (PDF, JPG or PNG, up to 5 MB)</label><input id="doc" ref={file} type="file" accept=".pdf,.jpg,.jpeg,.png" className="input py-2" /></div>
        <Button busy={busy} onClick={upload}><Upload className="size-4" />Upload</Button>
      </div>
      <div className="panel mt-5">{data && <DataTable rows={data} empty="No documents uploaded yet" columns={[
        { key: 'doc_type', label: 'Document', render: (r) => <span className="flex items-center gap-2"><FileText className="size-4 text-aqua" />{humanize(r.doc_type)}</span> },
        { key: 'original_name', label: 'File' }, { key: 'created_at', label: 'Uploaded', render: (r) => dateTime(r.created_at) }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />}</div>
    </>
  );
}
