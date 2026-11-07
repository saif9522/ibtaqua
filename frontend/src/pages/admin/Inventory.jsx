import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Plus, SlidersHorizontal, Search } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../../hooks/useApi';
import { api, errMsg } from '../../services/api';
import { toast } from '../../redux/store';
import { PageHeader, Loading, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Tabs, Badge, Stat } from '../../components/ui';
import { inr, dateTime, date, humanize, todayISO, toPaise, imgUrl } from '../../utils/format';

function AdjustModal({ target, onClose, onDone }) {
  const batches = useApi(target ? `/admin/batches?productId=${target.product_id}&status=active` : null);
  const [f, setF] = useState({ batchId: '', quantity: '', type: 'adjustment', reason: '' });
  const [run, busy] = useAction();
  if (!target) return null;
  return (
    <Modal open onClose={onClose} title={`Adjust stock · ${target.name}`} footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/admin/inventory/adjust', { productId: target.product_id, batchId: Number(f.batchId), quantity: Number(f.quantity), type: f.type, reason: f.reason }); toast('Stock updated'); onDone(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Save adjustment</Button>}>
      <div className="grid gap-3">
        <Select label="Type" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'adjustment', label: 'Correction (count mismatch)' }, { value: 'damage', label: 'Damaged / write-off' }]} />
        <Select label="Batch" placeholder="Choose batch" value={f.batchId} onChange={(e) => setF({ ...f, batchId: e.target.value })} options={(batches.data || []).map((b) => ({ value: b.id, label: `${b.batch_number} · ${b.quantity_remaining} left · exp ${b.expiry_date}` }))} />
        <Input label="Quantity" type="number" hint={f.type === 'damage' ? 'Use a negative number, e.g. -12' : 'Positive adds stock, negative removes'} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
        <Input label="Reason" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />
      </div>
    </Modal>
  );
}

export function InventoryPage() {
  const [tab, setTab] = useState('stock');
  return (
    <>
      <PageHeader title="Inventory" sub="Finished goods are tracked per production batch and sold first-expiry-first-out.">
        <Link to="/admin/batches" className="btn-primary"><Plus className="size-4" />Record production</Link>
      </PageHeader>
      <Tabs tabs={[{ value: 'stock', label: 'Finished goods' }, { value: 'materials', label: 'Packaging & jars' }, { value: 'movements', label: 'Stock movements' }]} value={tab} onChange={setTab} />
      {tab === 'stock' && <Stock />}{tab === 'materials' && <Materials />}{tab === 'movements' && <Movements />}
    </>
  );
}

function Stock() {
  const { data, loading, reload } = useApi('/admin/inventory');
  const [adj, setAdj] = useState(null);
  if (loading) return <Loading />;
  return (
    <div className="panel">
      <DataTable rows={data} rowKey="product_id" columns={[
        { key: 'name', label: 'Product', render: (r) => <div className="flex items-center gap-3"><img src={imgUrl(r.image)} alt="" className="size-9 rounded bg-mist" /><div><p className="font-semibold">{r.name}</p><p className="text-[12px] text-ink-soft">{r.sku}</p></div></div> },
        { key: 'quantity_available', label: 'Available', render: (r) => <span className={r.is_low ? 'font-semibold text-danger' : 'font-semibold'}>{r.quantity_available}{r.is_low ? <Badge tone="danger" className="ml-2">Low</Badge> : null}</span> },
        { key: 'quantity_reserved', label: 'Reserved for orders' }, { key: 'quantity_damaged', label: 'Damaged' },
        { key: 'low_stock_threshold', label: 'Alert at', render: (r) => <input className="input w-20 py-1" type="number" aria-label="Low stock threshold" defaultValue={r.low_stock_threshold} onBlur={(e) => Number(e.target.value) !== r.low_stock_threshold && api.patch(`/admin/inventory/${r.product_id}`, { lowStockThreshold: Number(e.target.value) }).then(() => { toast('Threshold saved'); reload(); })} /> },
        { key: 'active_batches', label: 'Batches' }, { key: 'next_expiry', label: 'Next expiry', render: (r) => (r.next_expiry ? date(r.next_expiry) : '—') },
        { key: 'act', label: '', render: (r) => <button className="btn-ghost btn-sm" onClick={() => setAdj(r)}><SlidersHorizontal className="size-4" />Adjust</button> },
      ]} />
      <AdjustModal target={adj} onClose={() => setAdj(null)} onDone={() => { setAdj(null); reload(); }} />
    </div>
  );
}

function Materials() {
  const { data, reload } = useApi('/admin/materials');
  const [m, setM] = useState(null);
  const [f, setF] = useState({ quantity: '', note: '' });
  const [add, setAdd] = useState(false);
  const [n, setN] = useState({ name: '', unit: 'pcs', quantity: 0, lowStockThreshold: 0 });
  const [run, busy] = useAction();
  return (
    <>
      <div className="mb-3 flex justify-end"><button className="btn-outline btn-sm" onClick={() => setAdd(true)}><Plus className="size-4" />Add material</button></div>
      <div className="panel">{data && <DataTable rows={data} columns={[
        { key: 'name', label: 'Material', render: (r) => <b>{r.name}</b> }, { key: 'quantity', label: 'In stock', render: (r) => <span className={r.quantity <= r.low_stock_threshold ? 'font-semibold text-danger' : ''}>{r.quantity} {r.unit}</span> },
        { key: 'low_stock_threshold', label: 'Alert at' }, { key: 'updated_at', label: 'Updated', render: (r) => dateTime(r.updated_at) },
        { key: 'a', label: '', render: (r) => <button className="btn-ghost btn-sm" onClick={() => { setF({ quantity: '', note: '' }); setM(r); }}>Receive / use</button> },
      ]} />}</div>
      <Modal open={!!m} onClose={() => setM(null)} title={m?.name} footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post(`/admin/materials/${m.id}/adjust`, { quantity: Number(f.quantity), note: f.note }); toast('Updated'); setM(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Save</Button>}>
        <div className="space-y-3"><Input label="Quantity" type="number" hint="Positive when received, negative when used or damaged" value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} /><Input label="Note" placeholder="e.g. Received from supplier, invoice 123" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} /></div>
      </Modal>
      <Modal open={add} onClose={() => setAdd(false)} title="New material" footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/admin/materials', { ...n, quantity: Number(n.quantity), lowStockThreshold: Number(n.lowStockThreshold) }); setAdd(false); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Add</Button>}>
        <div className="grid gap-3 sm:grid-cols-2"><Input className="sm:col-span-2" label="Name" onChange={(e) => setN({ ...n, name: e.target.value })} /><Input label="Unit" value={n.unit} onChange={(e) => setN({ ...n, unit: e.target.value })} /><Input label="Opening stock" type="number" onChange={(e) => setN({ ...n, quantity: e.target.value })} /><Input label="Alert at" type="number" onChange={(e) => setN({ ...n, lowStockThreshold: e.target.value })} /></div>
      </Modal>
    </>
  );
}

function Movements() {
  const [page, setPage] = useState(1);
  const [type, setType] = useState('');
  const { data } = useApi(`/admin/stock-movements?page=${page}&limit=50${type ? `&type=${type}` : ''}`);
  return (
    <>
      <select className="input mb-3 w-auto" aria-label="Movement type" value={type} onChange={(e) => { setType(e.target.value); setPage(1); }}><option value="">All movements</option>{['production', 'reserve', 'release', 'dispatch', 'return', 'damage', 'adjustment', 'expiry', 'material_in', 'material_out'].map((t) => <option key={t} value={t}>{humanize(t)}</option>)}</select>
      <div className="panel">{data && <DataTable rows={data.data} columns={[
        { key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) }, { key: 'type', label: 'Type', render: (r) => humanize(r.type) },
        { key: 'item', label: 'Item', render: (r) => r.product_name || r.material_name }, { key: 'batch_number', label: 'Batch' },
        { key: 'quantity', label: 'Qty', render: (r) => <span className={r.quantity < 0 ? 'text-danger' : 'text-ok'}>{r.quantity > 0 ? '+' : ''}{r.quantity}</span> },
        { key: 'ref', label: 'Reference', render: (r) => (r.reference_type === 'order' ? <Link className="link" to={`/admin/orders/${r.reference_id}`}>Order #{r.reference_id}</Link> : r.note || '') }, { key: 'user_name', label: 'By' },
      ]} />}{data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}</div>
    </>
  );
}

export function Batches() {
  const products = useApi('/admin/products?limit=100');
  const [status, setStatus] = useState('active');
  const { data, reload } = useApi(`/admin/batches${status ? `?status=${status}` : ''}`);
  const [open, setOpen] = useState(false);
  const today = todayISO();
  const [f, setF] = useState({ productId: '', batchNumber: `B${today.replace(/-/g, '').slice(2)}-`, manufacturingDate: today, expiryDate: '', quantity: '', notes: '' });
  const [run, busy] = useAction();
  const setShelf = (months) => { const d = new Date(`${f.manufacturingDate}T00:00:00Z`); d.setUTCMonth(d.getUTCMonth() + months); setF({ ...f, expiryDate: d.toISOString().slice(0, 10) }); };
  return (
    <>
      <PageHeader title="Manufacturing & batches" sub="Each production run becomes a batch with its own manufacturing and expiry date. Orders draw from the batch that expires first."><button className="btn-primary" onClick={() => setOpen(true)}><Plus className="size-4" />Record production</button></PageHeader>
      <Tabs tabs={[{ value: 'active', label: 'Active' }, 'quarantined', 'depleted', 'expired', { value: '', label: 'All' }]} value={status} onChange={setStatus} />
      <div className="panel">{data && <DataTable rows={data} empty="No batches" columns={[
        { key: 'batch_number', label: 'Batch', render: (r) => <b className="font-mono">{r.batch_number}</b> }, { key: 'product_name', label: 'Product' },
        { key: 'manufacturing_date', label: 'Made', render: (r) => date(r.manufacturing_date) }, { key: 'expiry_date', label: 'Expires', render: (r) => <span className={r.expiry_date < todayISO() ? 'text-danger' : ''}>{date(r.expiry_date)}</span> },
        { key: 'qty', label: 'Remaining', render: (r) => <>{r.quantity_remaining} <span className="text-ink-soft">/ {r.quantity_produced}</span></> },
        { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        { key: 'a', label: '', render: (r) => (r.status === 'active' ? <button className="btn-ghost btn-sm" onClick={() => window.confirm('Quarantine this batch? Its stock stops being sold.') && api.patch(`/admin/batches/${r.id}`, { status: 'quarantined' }).then(reload).catch((e) => toast(errMsg(e), 'danger'))}>Quarantine</button> : r.status === 'quarantined' ? <button className="btn-ghost btn-sm" onClick={() => api.patch(`/admin/batches/${r.id}`, { status: 'active' }).then(reload)}>Release</button> : null) },
      ]} />}</div>
      <Modal open={open} onClose={() => setOpen(false)} title="Record a production batch" footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/admin/batches', { ...f, productId: Number(f.productId), quantity: Number(f.quantity) }); toast('Batch recorded; stock updated'); setOpen(false); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Add to stock</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select className="sm:col-span-2" label="Product" placeholder="Choose" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value })} options={(products.data?.data || []).map((p) => ({ value: p.id, label: `${p.name} (${p.sku})` }))} />
          <Input label="Batch number" value={f.batchNumber} onChange={(e) => setF({ ...f, batchNumber: e.target.value })} />
          <Input label="Units produced" type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <Input label="Manufacturing date" type="date" max={today} value={f.manufacturingDate} onChange={(e) => setF({ ...f, manufacturingDate: e.target.value })} />
          <div><Input label="Expiry date" type="date" value={f.expiryDate} onChange={(e) => setF({ ...f, expiryDate: e.target.value })} /><div className="mt-1 flex gap-2 text-[12.5px]">{[3, 6, 12].map((m) => <button key={m} type="button" className="link" onClick={() => setShelf(m)}>+{m} months</button>)}</div></div>
          <Input className="sm:col-span-2" label="Notes (lab report no., line, shift)" value={f.notes} onChange={(e) => setF({ ...f, notes: e.target.value })} />
        </div>
      </Modal>
    </>
  );
}

export function Jars() {
  const [q, setQ] = useState('');
  const [role, setRole] = useState('');
  const search = useDebounced(q);
  const { data, reload } = useApi(`/admin/jars?pendingOnly=false${role ? `&role=${role}` : ''}${search ? `&search=${search}` : ''}`);
  const [sel, setSel] = useState(null);
  const [hist, setHist] = useState(null);
  const [f, setF] = useState({ type: 'returned', jars: '', amount: '', note: '' });
  const [run, busy] = useAction();
  const s = data?.summary;
  return (
    <>
      <PageHeader title="Empty jar management" sub="Running balance of 20L jars and deposits per buyer. Deliveries update this automatically; use it for counter returns, refunds and corrections." />
      {s && <div className="panel mb-5 grid grid-cols-2 divide-x divide-shoal sm:grid-cols-5">
        <Stat label="Jars delivered" value={s.delivered || 0} /><Stat label="Jars returned" value={s.returned || 0} /><Stat label="With buyers now" value={s.pending || 0} tone="warn" /><Stat label="Deposits held" value={inr(s.deposit || 0)} /><Stat label="Empty jars at plant" value={s.emptyJarsInPlant ?? '—'} />
      </div>}
      <div className="mb-3 flex flex-wrap gap-2">
        <div className="relative w-64"><Search className="absolute left-3 top-3 size-4 text-ink-soft" /><input className="input pl-9" placeholder="Name or phone" aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
        <select className="input w-auto" aria-label="Buyer type" value={role} onChange={(e) => setRole(e.target.value)}><option value="">All buyers</option>{['customer', 'retailer', 'wholesaler', 'distributor'].map((r) => <option key={r} value={r}>{humanize(r)}</option>)}</select>
      </div>
      <div className="panel">{data && <DataTable rows={data.data} empty="No jar balances yet" columns={[
        { key: 'name', label: 'Holder', render: (r) => <Link className="link" to={`/admin/users/${r.user_id}`}>{r.name}</Link> }, { key: 'role', label: 'Type', render: (r) => humanize(r.role) }, { key: 'phone', label: 'Phone' },
        { key: 'jars_delivered', label: 'Delivered' }, { key: 'jars_returned', label: 'Returned' }, { key: 'jars_pending', label: 'Pending', render: (r) => <b className={r.jars_pending > 10 ? 'text-danger' : ''}>{r.jars_pending}</b> },
        { key: 'deposit_held', label: 'Deposit', render: (r) => inr(r.deposit_held) },
        { key: 'a', label: '', render: (r) => <span className="flex gap-1"><button className="btn-ghost btn-sm" onClick={() => { setF({ type: 'returned', jars: '', amount: '', note: '' }); setSel(r); }}>Record</button><button className="btn-ghost btn-sm" onClick={async () => setHist({ r, rows: (await api.get(`/admin/jars/${r.user_id}/history`)).data })}>History</button></span> },
      ]} />}</div>
      <Modal open={!!sel} onClose={() => setSel(null)} title={`Jar entry · ${sel?.name}`} footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post(`/admin/jars/${sel.user_id}`, { type: f.type, jars: Number(f.jars || 0), amount: toPaise(f.amount), note: f.note }); toast('Recorded'); setSel(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Save</Button>}>
        <div className="grid gap-3">
          <Select label="Entry" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={[{ value: 'returned', label: 'Empty jars returned' }, { value: 'deposit_refunded', label: 'Deposit refunded' }, { value: 'deposit_collected', label: 'Deposit collected' }, { value: 'damaged', label: 'Jar damaged' }, { value: 'lost', label: 'Jar lost' }, { value: 'adjustment', label: 'Correction (+/−)' }]} />
          {!['deposit_refunded', 'deposit_collected'].includes(f.type) && <Input label="Number of jars" type="number" value={f.jars} onChange={(e) => setF({ ...f, jars: e.target.value })} hint={`Pending with buyer: ${sel?.jars_pending}`} />}
          {['deposit_refunded', 'deposit_collected'].includes(f.type) && <Input label="Amount (₹)" type="number" value={f.amount} onChange={(e) => setF({ ...f, amount: e.target.value })} hint={`Deposit held: ${inr(sel?.deposit_held)}`} />}
          <Input label="Note" value={f.note} onChange={(e) => setF({ ...f, note: e.target.value })} />
        </div>
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title={`Jar history · ${hist?.r.name}`} wide>
        {hist && <DataTable rows={hist.rows} columns={[{ key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) }, { key: 'type', label: 'Entry', render: (r) => humanize(r.type) }, { key: 'jars', label: 'Jars' }, { key: 'amount', label: 'Amount', render: (r) => (r.amount ? inr(r.amount) : '') }, { key: 'order_number', label: 'Order' }, { key: 'note', label: 'Note' }, { key: 'recorded_by_name', label: 'By' }]} />}
      </Modal>
    </>
  );
}
