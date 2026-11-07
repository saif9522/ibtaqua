import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Download, Truck, Search, FileText, Banknote, Plus } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../../hooks/useApi';
import { api, errMsg, openBlob } from '../../services/api';
import { toast } from '../../redux/store';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Textarea, Badge } from '../../components/ui';
import { inr, dateTime, date, humanize, TIER_LABEL, toPaise } from '../../utils/format';

const STATUSES = ['pending', 'confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'out_for_delivery', 'delivered', 'cancelled', 'return_requested', 'returned'];

function AssignModal({ open, onClose, orderIds, onDone }) {
  const staff = useApi(open ? '/admin/users?role=delivery&status=active&limit=100' : null);
  const [sid, setSid] = useState('');
  const [run, busy] = useAction();
  return (
    <Modal open={open} onClose={onClose} title={`Assign ${orderIds.length} order${orderIds.length > 1 ? 's' : ''} to delivery`} footer={<Button busy={busy} disabled={!sid} onClick={() => run(async () => { try { await api.post('/admin/delivery/assign', { orderIds, staffId: Number(sid) }); toast('Assigned'); onDone(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Assign</Button>}>
      <Select label="Delivery partner" placeholder="Choose" value={sid} onChange={(e) => setSid(e.target.value)} options={(staff.data?.data || []).map((s) => ({ value: s.staff_id, label: `${s.name} · ${s.zone_name || 'No zone'}${s.is_available ? '' : ' (unavailable)'}` }))} />
    </Modal>
  );
}

export function OrderList() {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('search') || '');
  const search = useDebounced(q);
  const f = Object.fromEntries(sp);
  const page = Number(f.page || 1);
  const qs = new URLSearchParams({ ...f, page, limit: 25, ...(search && { search }) });
  const { data, loading, error, reload } = useApi(`/admin/orders?${qs}`, { poll: 30000 });
  const zones = useApi('/admin/zones');
  const [sel, setSel] = useState([]);
  const [assign, setAssign] = useState(false);
  const [bulk, setBulk] = useState('');
  const [newOrder, setNewOrder] = useState(false);
  const [run, busy] = useAction();
  const navigate = useNavigate();
  const set = (k, v) => { if (v) sp.set(k, v); else sp.delete(k); sp.delete('page'); setSp(sp); setSel([]); };
  const toggle = (id) => setSel(sel.includes(id) ? sel.filter((x) => x !== id) : [...sel, id]);
  const applyBulk = () => run(async () => {
    const r = await api.post('/admin/orders/bulk-status', { ids: sel, status: bulk });
    const failed = r.data.results.filter((x) => !x.ok);
    toast(failed.length ? `${sel.length - failed.length} updated, ${failed.length} skipped: ${failed[0].message}` : `${sel.length} orders updated`, failed.length ? 'danger' : 'ok');
    setSel([]); setBulk(''); reload();
  });

  return (
    <>
      <PageHeader title="Orders"><button className="btn-primary" onClick={() => setNewOrder(true)}><Plus className="size-4" />New order for a buyer</button></PageHeader>
      <div className="mb-4 flex flex-wrap gap-2">
        <div className="relative min-w-56 flex-1"><Search className="absolute left-3 top-3 size-4 text-ink-soft" /><input className="input pl-9" placeholder="Order number, name or phone" aria-label="Search orders" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto" aria-label="Status" value={f.status || ''} onChange={(e) => set('status', e.target.value)}><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <select className="input w-auto" aria-label="Buyer type" value={f.buyer_tier || ''} onChange={(e) => set('buyer_tier', e.target.value)}><option value="">All buyers</option>{Object.entries(TIER_LABEL).map(([v, l]) => <option key={v} value={v}>{l}</option>)}</select>
        <select className="input w-auto" aria-label="Payment" value={f.payment_status || ''} onChange={(e) => set('payment_status', e.target.value)}><option value="">Any payment</option>{['unpaid', 'pending_verification', 'partially_paid', 'paid', 'refunded'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <select className="input w-auto" aria-label="Zone" value={f.zoneId || ''} onChange={(e) => set('zoneId', e.target.value)}><option value="">All zones</option>{(zones.data || []).map((z) => <option key={z.id} value={z.id}>{z.name}</option>)}</select>
        <input type="date" className="input w-auto" aria-label="Delivery date" value={f.deliveryDate || ''} onChange={(e) => set('deliveryDate', e.target.value)} />
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" className="accent-[var(--color-aqua)]" checked={f.unassigned === 'true'} onChange={(e) => set('unassigned', e.target.checked ? 'true' : '')} />Not assigned</label>
      </div>
      {sel.length > 0 && (
        <div className="mb-3 flex flex-wrap items-center gap-2 rounded-[var(--radius-ctl)] bg-depth px-4 py-2.5 text-sm text-white">
          <span className="font-semibold">{sel.length} selected</span>
          <select className="input w-auto py-1.5 text-ink" aria-label="Move to status" value={bulk} onChange={(e) => setBulk(e.target.value)}><option value="">Move to…</option>{STATUSES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
          <Button size="sm" busy={busy} disabled={!bulk} onClick={applyBulk}>Apply</Button>
          <button className="btn btn-sm bg-white/10 text-white hover:bg-white/20" onClick={() => setAssign(true)}><Truck className="size-4" />Assign delivery</button>
          <button className="ml-auto text-[#cfe6ee] underline" onClick={() => setSel([])}>Clear</button>
        </div>
      )}
      <div className="panel">
        {loading && !data && <Loading />}
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
        {data && (
          <DataTable rows={data.data} empty="No orders match these filters" onRowClick={(r) => navigate(`/admin/orders/${r.id}`)} columns={[
            { key: 'sel', label: <input type="checkbox" aria-label="Select all" className="accent-[var(--color-aqua)]" checked={sel.length === data.data.length && sel.length > 0} onChange={(e) => setSel(e.target.checked ? data.data.map((r) => r.id) : [])} />, render: (r) => <input type="checkbox" aria-label={`Select ${r.order_number}`} className="accent-[var(--color-aqua)]" checked={sel.includes(r.id)} onClick={(e) => e.stopPropagation()} onChange={() => toggle(r.id)} /> },
            { key: 'order_number', label: 'Order', render: (r) => <><p className="font-semibold text-depth">{r.order_number}</p><p className="text-[12px] text-ink-soft">{dateTime(r.created_at)} · {r.source}</p></> },
            { key: 'buyer', label: 'Buyer', render: (r) => <><p>{r.buyer_name}</p><p className="text-[12px] text-ink-soft">{TIER_LABEL[r.buyer_tier]} · {r.buyer_phone}</p></> },
            { key: 'zone_name', label: 'Zone / slot', render: (r) => <><p>{r.zone_name}</p><p className="text-[12px] text-ink-soft">{r.delivery_date ? date(r.delivery_date) : ''} {r.delivery_slot}</p></> },
            { key: 'grand_total', label: 'Total', render: (r) => <><p className="font-semibold">{inr(r.grand_total)}</p><p className="text-[12px] text-ink-soft">{humanize(r.payment_method)}</p></> },
            { key: 'payment_status', label: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> },
            { key: 'driver', label: 'Delivery', render: (r) => r.driver || <span className="text-ink-soft">—</span> },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        )}
        {data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={(p) => { sp.set('page', p); setSp(sp); }} /></div>}
      </div>
      <AssignModal open={assign} onClose={() => setAssign(false)} orderIds={sel} onDone={() => { setAssign(false); setSel([]); reload(); }} />
      <NewOrderModal open={newOrder} onClose={() => setNewOrder(false)} onDone={(id) => navigate(`/admin/orders/${id}`)} />
    </>
  );
}

function NewOrderModal({ open, onClose, onDone }) {
  const [phone, setPhone] = useState('');
  const [buyer, setBuyer] = useState(null);
  const [lines, setLines] = useState([{ productId: '', quantity: 1 }]);
  const [method, setMethod] = useState('cod');
  const [addrId, setAddrId] = useState('');
  const products = useApi(open ? '/admin/products?limit=100' : null);
  const [run, busy] = useAction();
  const find = () => run(async () => {
    for (const role of ['customer', 'retailer', 'wholesaler', 'distributor']) {
      const r = await api.get(`/admin/users?role=${role}&search=${phone}`);
      if (r.data.data[0]) { const d = await api.get(`/admin/users/${r.data.data[0].id}`); setBuyer(d.data); setAddrId(d.data.addresses[0]?.id || ''); return; }
    }
    toast('No buyer with that phone. Create them under Customers first.', 'danger');
  });
  const place = () => run(async () => {
    try { const r = await api.post('/admin/orders', { userId: buyer.id, addressId: Number(addrId), paymentMethod: method, items: lines.filter((l) => l.productId).map((l) => ({ productId: Number(l.productId), quantity: Number(l.quantity) })) }); toast(`Order ${r.data.order_number} created`); onDone(r.data.id); } catch (e) { toast(errMsg(e), 'danger'); }
  });
  return (
    <Modal open={open} onClose={onClose} title="New order for a buyer" wide footer={buyer && <Button busy={busy} disabled={!addrId} onClick={place}>Create order</Button>}>
      <div className="flex items-end gap-2"><Input className="flex-1" label="Buyer's mobile number" value={phone} onChange={(e) => setPhone(e.target.value.replace(/\D/g, ''))} maxLength={10} /><Button variant="outline" busy={busy} onClick={find}>Find</Button></div>
      {buyer && (
        <div className="mt-4 space-y-3">
          <p className="text-sm"><b>{buyer.name}</b> · {humanize(buyer.role)}{buyer.business ? ` · ${buyer.business.business_name}` : ''}</p>
          {!buyer.addresses.length ? <p className="text-sm text-danger">This buyer has no saved address. Add one from their account first.</p>
            : <Select label="Deliver to" value={addrId} onChange={(e) => setAddrId(e.target.value)} options={buyer.addresses.map((a) => ({ value: a.id, label: `${a.label}: ${a.line1}, ${a.pincode}` }))} />}
          {lines.map((l, i) => (
            <div key={i} className="flex gap-2">
              <select className="input" aria-label="Product" value={l.productId} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, productId: e.target.value } : x)))}><option value="">Product</option>{(products.data?.data || []).map((p) => <option key={p.id} value={p.id}>{p.name}</option>)}</select>
              <input className="input w-24" type="number" min={1} aria-label="Quantity" value={l.quantity} onChange={(e) => setLines(lines.map((x, k) => (k === i ? { ...x, quantity: e.target.value } : x)))} />
            </div>
          ))}
          <button className="link text-sm" onClick={() => setLines([...lines, { productId: '', quantity: 1 }])}>Add another product</button>
          <Select label="Payment" value={method} onChange={(e) => setMethod(e.target.value)} options={['cod', 'credit', 'bank_transfer', 'razorpay']} />
          <p className="text-[13px] text-ink-soft">Prices are applied from the buyer's tier automatically.</p>
        </div>
      )}
    </Modal>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const { data: o, loading, error, reload } = useApi(`/admin/orders/${id}`, { poll: 30000 });
  const [run, busy] = useAction();
  const [modal, setModal] = useState(null);
  const [note, setNote] = useState('');
  const [cash, setCash] = useState('');
  if (loading && !o) return <Loading />;
  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  const move = (to) => run(async () => { try { await api.post(`/admin/orders/${o.id}/status`, { status: to, note: note || undefined }); toast(`Order moved to ${humanize(to)}`); setNote(''); setModal(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  const due = o.grand_total - o.amount_paid;
  return (
    <>
      <PageHeader title={o.order_number} back="/admin/orders" sub={`${o.buyer_name} · ${TIER_LABEL[o.buyer_tier]} · placed ${dateTime(o.created_at)} via ${o.source}`}>
        <StatusBadge status={o.status} />
        {o.invoice ? <button className="btn-outline btn-sm" onClick={() => openBlob(`/admin/orders/${o.id}/invoice.pdf`)}><Download className="size-4" />{o.invoice.invoice_number}</button>
          : !['pending', 'cancelled'].includes(o.status) && <Button variant="outline" size="sm" busy={busy} onClick={() => run(async () => { await api.post(`/admin/orders/${o.id}/invoice`); reload(); })}><FileText className="size-4" />Issue invoice</Button>}
      </PageHeader>

      <div className="panel mb-5 flex flex-wrap items-center gap-2 p-4">
        <span className="mr-1 text-sm font-semibold">Move to:</span>
        {o.allowedTransitions.length ? o.allowedTransitions.map((t) => (
          <Button key={t} size="sm" variant={t === 'cancelled' ? 'outline' : 'primary'} busy={busy} onClick={() => (t === 'cancelled' ? setModal('cancel') : move(t))}>{humanize(t)}</Button>
        )) : <span className="text-sm text-ink-soft">No further status changes.</span>}
        {['confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched'].includes(o.status) && <button className="btn-outline btn-sm ml-auto" onClick={() => setModal('assign')}><Truck className="size-4" />{o.delivery ? 'Reassign delivery' : 'Assign delivery'}</button>}
      </div>

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          <div className="panel">
            <DataTable rows={o.items} columns={[
              { key: 'product_name', label: 'Product', render: (r) => <><p className="font-semibold">{r.product_name}</p><p className="text-[12px] text-ink-soft">{r.sku} · price from {r.price_source}</p></> },
              { key: 'quantity', label: 'Qty' }, { key: 'unit_price', label: 'Rate', render: (r) => inr(r.unit_price) },
              { key: 'taxable_amount', label: 'Taxable', render: (r) => inr(r.taxable_amount) }, { key: 'gst', label: 'GST', render: (r) => `${inr(r.gst_amount)} (${Number(r.gst_percent)}%)` },
              { key: 'line_total', label: 'Total', render: (r) => <b>{inr(r.line_total)}</b> },
            ]} />
            <dl className="grid grid-cols-2 gap-y-1 border-t border-shoal px-5 py-4 text-sm sm:grid-cols-4">
              <dt className="text-ink-soft">Discount</dt><dd>{inr(o.discount_total)}</dd><dt className="text-ink-soft">Delivery</dt><dd>{inr(o.delivery_charge)}</dd>
              <dt className="text-ink-soft">Jar deposit</dt><dd>{inr(o.jar_deposit_total)}</dd><dt className="font-semibold">Grand total</dt><dd className="font-semibold">{inr(o.grand_total)}</dd>
            </dl>
          </div>
          {!!o.batches.length && (
            <div className="panel p-5"><h2 className="text-lg">Batches allocated (FIFO)</h2><ul className="mt-2 text-sm">{o.batches.map((b, i) => <li key={i}>{b.product_name}: {b.quantity} from <b>{b.batch_number}</b> (expires {date(b.expiry_date)})</li>)}</ul></div>
          )}
          <div className="panel p-5">
            <h2 className="text-lg">Timeline</h2>
            <ol className="mt-3 space-y-2 border-l-2 border-shoal pl-4 text-sm">{o.timeline.slice().reverse().map((t) => <li key={t.id}><b className="text-depth">{humanize(t.to_status)}</b> <span className="text-ink-soft">· {dateTime(t.created_at)}{t.note ? ` · ${t.note}` : ''}</span></li>)}</ol>
          </div>
        </div>
        <div className="space-y-5">
          <div className="panel p-5 text-sm">
            <h2 className="text-lg">Buyer</h2>
            <p className="mt-2"><Link className="link" to={`/admin/users/${o.user_id}`}>{o.buyer_name}</Link> · <a className="link" href={`tel:+91${o.buyer_phone}`}>{o.buyer_phone}</a></p>
            <p className="mt-2 text-ink-soft">{[o.address.contact_name, o.address.contact_phone].join(' · ')}<br />{[o.address.line1, o.address.line2, o.address.landmark, o.address.city, o.address.pincode].filter(Boolean).join(', ')}</p>
            {o.delivery_date && <p className="mt-2">Deliver {date(o.delivery_date)} · {o.delivery_slot}</p>}
            {o.notes && <p className="mt-2 rounded bg-marigold-soft px-2 py-1 text-[#7a540e]">{o.notes}</p>}
            <p className="mt-2 text-ink-soft">Delivery OTP: <span className="font-mono font-semibold text-ink">{o.delivery_otp}</span></p>
            {o.delivery && <p className="mt-2">Driver: {o.delivery.staff_name} <StatusBadge status={o.delivery.status} /></p>}
          </div>
          <div className="panel p-5 text-sm">
            <div className="flex items-center justify-between"><h2 className="text-lg">Payment</h2><StatusBadge status={o.payment_status} /></div>
            <p className="mt-1 text-ink-soft">{humanize(o.payment_method)} · paid {inr(o.amount_paid)} of {inr(o.grand_total)}{o.due_date ? ` · due ${date(o.due_date)}` : ''}</p>
            <ul className="mt-3 space-y-2">{o.payments.map((p) => (
              <li key={p.id} className="flex items-center justify-between gap-2 rounded bg-mist px-3 py-2">
                <span>{humanize(p.method)} {p.reference_no || p.provider_payment_id ? <span className="text-ink-soft">· {p.reference_no || p.provider_payment_id}</span> : ''}<br /><StatusBadge status={p.status} />{p.refunded_amount > 0 && <Badge className="ml-1">refunded {inr(p.refunded_amount)}</Badge>}</span>
                <span className="text-right font-semibold">{inr(p.amount)}{p.status === 'pending_verification' && <Link to="/admin/payments?status=pending_verification" className="block text-[12px] link">Verify</Link>}</span>
              </li>
            ))}</ul>
            {due > 0 && !['cancelled', 'returned'].includes(o.status) && (
              <form className="mt-3 flex gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { try { await api.post('/admin/payments/cash', { orderId: o.id, amount: toPaise(cash) }); toast('Cash recorded'); setCash(''); reload(); } catch (er) { toast(errMsg(er), 'danger'); } }); }}>
                <input className="input" type="number" step="0.01" min="0" placeholder={`Cash received (due ${inr(due)})`} aria-label="Cash received" value={cash} onChange={(e) => setCash(e.target.value)} required />
                <Button busy={busy} className="shrink-0"><Banknote className="size-4" />Record</Button>
              </form>
            )}
          </div>
          {o.returnRequest && <div className="panel p-5 text-sm"><h2 className="text-lg">Return request</h2><p className="mt-1">{o.returnRequest.reason}</p><p className="mt-1"><StatusBadge status={o.returnRequest.status} /> <Link to="/admin/support?tab=returns" className="link ml-2">Decide</Link></p></div>}
        </div>
      </div>
      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel order" footer={<Button variant="danger" busy={busy} onClick={() => move('cancelled')}>Cancel order</Button>}>
        <Textarea label="Reason (shown to the buyer)" value={note} onChange={(e) => setNote(e.target.value)} />
        {o.amount_paid > 0 && <p className="mt-2 text-sm text-[#9a6a12]">{inr(o.amount_paid)} has been paid. Issue the refund from Payments after cancelling.</p>}
      </Modal>
      <AssignModal open={modal === 'assign'} onClose={() => setModal(null)} orderIds={[o.id]} onDone={() => { setModal(null); reload(); }} />
    </>
  );
}
