import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { Search, Plus, FileText, Check, X } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../../hooks/useApi';
import { api, errMsg, openBlob } from '../../services/api';
import { toast } from '../../redux/store';
import { useAuth } from '../../hooks/useSite';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Tabs, Badge, Stat, Checkbox } from '../../components/ui';
import { inr, dateTime, date, humanize, ago, toPaise, toRupees, TIER_LABEL } from '../../utils/format';

const TITLES = { customer: 'Customers', retailer: 'Retailers', wholesaler: 'Wholesalers', distributor: 'Distributors', delivery: 'Delivery staff' };

export function UserList({ role }) {
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const status = sp.get('status') || '';
  const page = Number(sp.get('page') || 1);
  const { data, loading, error, reload } = useApi(`/admin/users?role=${role}&page=${page}&limit=25${status ? `&status=${status}` : ''}${search ? `&search=${search}` : ''}`);
  const [creating, setCreating] = useState(false);
  const navigate = useNavigate();
  const b2b = ['retailer', 'wholesaler', 'distributor'].includes(role);
  return (
    <>
      <PageHeader title={TITLES[role]}><button className="btn-primary" onClick={() => setCreating(true)}><Plus className="size-4" />Add {role === 'delivery' ? 'staff' : TIER_LABEL[role]?.toLowerCase()}</button></PageHeader>
      <Tabs tabs={[{ value: '', label: 'All' }, ...(b2b ? [{ value: 'pending', label: 'Awaiting approval' }] : []), { value: 'active', label: 'Active' }, { value: 'suspended', label: 'Suspended' }, ...(b2b ? [{ value: 'rejected', label: 'Rejected' }] : [])]} value={status} onChange={(v) => { if (v) sp.set('status', v); else sp.delete('status'); sp.delete('page'); setSp(sp); }} />
      <div className="relative mb-4 max-w-sm"><Search className="absolute left-3 top-3 size-4 text-ink-soft" /><input className="input pl-9" placeholder={b2b ? 'Name, business, GSTIN, phone' : 'Name, phone, email'} aria-label="Search" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="panel">
        {loading && !data && <Loading />}
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
        {data && <DataTable rows={data.data} onRowClick={(r) => navigate(`/admin/users/${r.id}`)} empty={`No ${TITLES[role].toLowerCase()} found`} columns={[
          { key: 'name', label: b2b ? 'Business' : 'Name', render: (r) => <><p className="font-semibold">{b2b ? r.business_name : r.name}</p><p className="text-[12px] text-ink-soft">{b2b ? `${r.name} · ` : ''}{r.phone}</p></> },
          ...(b2b ? [{ key: 'gstin', label: 'GSTIN', render: (r) => r.gstin || '—' }, { key: 'city', label: 'City' },
            { key: 'credit', label: 'Credit', render: (r) => (r.credit_enabled ? <>{inr(r.outstanding)} <span className="text-ink-soft">/ {inr(r.credit_limit)}</span></> : <span className="text-ink-soft">Off</span>) }] : []),
          ...(role === 'delivery' ? [{ key: 'zone_name', label: 'Zone' }, { key: 'vehicle_number', label: 'Vehicle' }, { key: 'is_available', label: 'Available', render: (r) => (r.is_available ? 'Yes' : 'No') }] : []),
          ...(role !== 'delivery' ? [{ key: 'order_count', label: 'Orders' }, { key: 'lifetime_value', label: 'Purchased', render: (r) => inr(r.lifetime_value) }] : []),
          { key: 'created_at', label: 'Joined', render: (r) => date(r.created_at) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />}
        {data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={(p) => { sp.set('page', p); setSp(sp); }} /></div>}
      </div>
      <CreateUser role={role} open={creating} onClose={() => setCreating(false)} onDone={(id) => navigate(`/admin/users/${id}`)} />
    </>
  );
}

function CreateUser({ role, open, onClose, onDone }) {
  const zones = useApi(open && role === 'delivery' ? '/admin/zones' : null);
  const [f, setF] = useState({ state: 'Jharkhand' });
  const [run, busy] = useAction();
  const b2b = ['retailer', 'wholesaler', 'distributor'].includes(role);
  const set = (k) => (e) => setF({ ...f, [k]: e.target.value });
  return (
    <Modal open={open} onClose={onClose} title={`Add ${role === 'delivery' ? 'delivery staff' : TIER_LABEL[role]?.toLowerCase()}`} footer={<Button busy={busy} onClick={() => run(async () => { try { const r = await api.post('/admin/users', { ...f, role, zoneId: f.zoneId ? Number(f.zoneId) : undefined }); toast('Account created'); onDone(r.data.id); } catch (e) { toast(errMsg(e), 'danger'); } })}>Create account</Button>}>
      <div className="grid gap-3 sm:grid-cols-2">
        <Input label="Name" onChange={set('name')} /><Input label="Mobile" maxLength={10} onChange={set('phone')} />
        <Input label="Email (optional)" onChange={set('email')} />
        {(b2b || role === 'delivery') && <Input label={role === 'delivery' ? 'Password' : 'Password (optional)'} type="password" hint="8+ characters with a letter and a number" onChange={set('password')} />}
        {b2b && <><Input className="sm:col-span-2" label="Business name" onChange={set('businessName')} /><Input label="GSTIN" onChange={set('gstin')} /><Input label="City" onChange={set('city')} /><Input label="Pincode" maxLength={6} onChange={set('pincode')} /><Input label="Address" onChange={set('address')} /></>}
        {role === 'delivery' && <><Input label="Vehicle number" onChange={set('vehicleNumber')} /><Select label="Zone" placeholder="Any" options={(zones.data || []).map((z) => ({ value: z.id, label: z.name }))} onChange={set('zoneId')} /></>}
      </div>
      {b2b && <p className="mt-3 text-[13px] text-ink-soft">Accounts created here are approved immediately.</p>}
    </Modal>
  );
}

export function UserDetail() {
  const { id } = useParams();
  const { can } = useAuth();
  const { data: u, loading, error, reload } = useApi(`/admin/users/${id}`);
  const zones = useApi('/admin/zones');
  const [run, busy] = useAction();
  const [modal, setModal] = useState(null);
  const [f, setF] = useState({});
  if (loading && !u) return <Loading />;
  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  const b = u.business;
  const b2b = !!b;
  const call = (fn, msg) => run(async () => { try { await fn(); toast(msg); setModal(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  const openEdit = () => { setF({ name: u.name, email: u.email || '', ...(b && { businessName: b.business_name, gstin: b.gstin || '', city: b.city || '', creditEnabled: !!b.credit_enabled, creditLimit: toRupees(b.credit_limit), creditDays: b.credit_days, agreementRef: b.agreement_ref || '', agreementValidTo: b.agreement_valid_to || '' }), ...(u.delivery && { vehicleNumber: u.delivery.vehicle_number || '', zoneId: u.delivery.zone_id || '' }) }); setModal('edit'); };
  const saveEdit = () => call(() => api.patch(`/admin/users/${u.id}`, {
    name: f.name, email: f.email,
    ...(b2b && { business: { businessName: f.businessName, gstin: f.gstin || undefined, city: f.city, creditEnabled: f.creditEnabled, creditLimit: toPaise(f.creditLimit), creditDays: Number(f.creditDays), ...(u.role === 'distributor' && { agreementRef: f.agreementRef, agreementValidTo: f.agreementValidTo || undefined }) } }),
    ...(u.delivery && { delivery: { vehicleNumber: f.vehicleNumber, zoneId: f.zoneId ? Number(f.zoneId) : null } }),
  }), 'Saved');

  return (
    <>
      <PageHeader title={b?.business_name || u.name} back={`/admin/${u.role === 'delivery' ? 'delivery-staff' : `${u.role}s`}`} sub={`${humanize(u.role)} · ${u.phone}${u.email ? ` · ${u.email}` : ''} · joined ${date(u.created_at)}`}>
        <StatusBadge status={u.status} />
        {can('users.write') && <button className="btn-outline btn-sm" onClick={openEdit}>Edit</button>}
        {can('users.write') && u.status === 'active' && <Button variant="outline" size="sm" busy={busy} onClick={() => window.confirm('Suspend this account? They will be logged out.') && call(() => api.patch(`/admin/users/${u.id}`, { status: 'suspended' }), 'Account suspended')}>Suspend</Button>}
        {can('users.write') && u.status === 'suspended' && <Button size="sm" busy={busy} onClick={() => call(() => api.patch(`/admin/users/${u.id}`, { status: 'active' }), 'Account reactivated')}>Reactivate</Button>}
        {can('users.write') && u.role !== 'customer' && <button className="btn-outline btn-sm" onClick={() => { setF({ password: '' }); setModal('pw'); }}>Reset password</button>}
      </PageHeader>

      {b2b && b.approval_status === 'pending' && can('partners.approve') && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-[var(--radius-panel)] border border-marigold/40 bg-marigold-soft p-4">
          <p className="flex-1 text-sm text-[#7a540e]"><b>Application awaiting approval.</b> Check the GSTIN and documents below before approving.</p>
          <button className="btn-primary btn-sm" onClick={() => { setF({ decision: 'approved', creditLimit: '', creditDays: 15 }); setModal('approve'); }}><Check className="size-4" />Approve</button>
          <button className="btn-outline btn-sm" onClick={() => { setF({ decision: 'rejected', reason: '' }); setModal('approve'); }}><X className="size-4" />Reject</button>
        </div>
      )}

      <div className="panel grid grid-cols-2 divide-x divide-shoal sm:grid-cols-4">
        <Stat label="Orders" value={u.recentOrders.length >= 10 ? '10+' : u.recentOrders.length} />
        <Stat label="Outstanding" value={inr(u.outstanding)} tone={u.outstanding ? 'warn' : undefined} />
        {b2b ? <Stat label="Credit limit" value={b.credit_enabled ? inr(b.credit_limit) : 'Off'} note={b.credit_enabled ? `${b.credit_days} days` : undefined} /> : <Stat label="Empty jars held" value={u.jarBalance?.jars_pending ?? 0} />}
        <Stat label="Jar deposit" value={inr(u.jarBalance?.deposit_held || 0)} />
      </div>

      <div className="mt-5 grid gap-5 lg:grid-cols-2">
        {b2b && (
          <section className="panel p-5 text-sm">
            <h2 className="text-lg">Business</h2>
            <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5">
              <dt className="text-ink-soft">GSTIN</dt><dd className="font-mono">{b.gstin || '—'}</dd><dt className="text-ink-soft">PAN</dt><dd className="font-mono">{b.pan || '—'}</dd>
              <dt className="text-ink-soft">Contact</dt><dd>{b.contact_person}</dd><dt className="text-ink-soft">Address</dt><dd>{[b.business_address, b.city, b.state, b.pincode].filter(Boolean).join(', ')}</dd>
              <dt className="text-ink-soft">Approval</dt><dd><StatusBadge status={b.approval_status} /> {b.rejection_reason}</dd>
              {u.role === 'distributor' && <><dt className="text-ink-soft">Agreement</dt><dd>{b.agreement_ref || '—'}{b.agreement_valid_to ? ` until ${date(b.agreement_valid_to)}` : ''}</dd></>}
            </dl>
            {u.role === 'distributor' && (
              <div className="mt-4"><p className="font-semibold">Distribution areas</p>
                <div className="mt-2 flex flex-wrap gap-3">{(zones.data || []).map((z) => <Checkbox key={z.id} label={z.name} checked={u.zones?.includes(z.id)} onChange={(e) => call(() => api.patch(`/admin/users/${u.id}`, { zones: e.target.checked ? [...u.zones, z.id] : u.zones.filter((x) => x !== z.id) }), 'Areas updated')} />)}</div>
              </div>
            )}
          </section>
        )}
        {b2b && (
          <section className="panel p-5 text-sm">
            <h2 className="text-lg">Documents</h2>
            {!u.documents.length && <p className="mt-2 text-ink-soft">No documents uploaded.</p>}
            <ul className="mt-2 space-y-2">{u.documents.map((d) => (
              <li key={d.id} className="flex items-center gap-2 rounded bg-mist px-3 py-2">
                <FileText className="size-4 text-aqua" /><button className="link flex-1 text-left" onClick={() => openBlob(`/admin/documents/${d.id}/file`)}>{humanize(d.doc_type)} · {d.original_name}</button><StatusBadge status={d.status} />
                {can('partners.approve') && d.status !== 'verified' && <button className="text-ok" title="Mark verified" onClick={() => call(() => api.patch(`/admin/documents/${d.id}`, { status: 'verified' }), 'Marked verified')}><Check className="size-4" /></button>}
              </li>
            ))}</ul>
            {!!u.creditRequests.length && <>
              <h3 className="mt-5 font-semibold">Credit requests</h3>
              <ul className="mt-2 space-y-1">{u.creditRequests.map((c) => <li key={c.id} className="flex justify-between"><span>{inr(c.requested_limit)} · {c.reason || 'No reason given'}</span><StatusBadge status={c.status} /></li>)}</ul>
              <Link to="/admin/credit-requests" className="link mt-1 inline-block">Review credit requests</Link>
            </>}
          </section>
        )}
        <section className="panel">
          <div className="flex items-center justify-between px-5 pt-4"><h2 className="text-lg">Recent orders</h2><Link className="link text-sm" to={`/admin/orders?search=${u.phone}`}>All orders</Link></div>
          <DataTable rows={u.recentOrders} empty="No orders" columns={[
            { key: 'order_number', label: 'Order', render: (r) => <Link className="link" to={`/admin/orders/${r.id}`}>{r.order_number}</Link> },
            { key: 'created_at', label: 'Placed', render: (r) => ago(r.created_at) }, { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total) },
            { key: 'payment_status', label: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />
        </section>
        <section className="panel p-5 text-sm">
          <h2 className="text-lg">Addresses</h2>
          <ul className="mt-2 space-y-2">{u.addresses.map((a) => <li key={a.id}><b>{a.label}</b> · {[a.line1, a.city, a.pincode].join(', ')}{!a.zone_id && <Badge tone="danger" className="ml-1">No zone</Badge>}</li>)}</ul>
          {!!u.negotiatedPrices.length && <><h3 className="mt-4 font-semibold">Agreed prices</h3><ul className="mt-1">{u.negotiatedPrices.map((n) => <li key={n.id}>{n.product_name}: {inr(n.price)} (min {n.min_order_qty}){n.valid_to ? ` until ${date(n.valid_to)}` : ''}</li>)}</ul></>}
          <Link to="/admin/jars" className="link mt-4 inline-block">Jar ledger</Link>
          {b2b && <> · <Link to={`/admin/payments?settle=${u.id}`} className="link">Record a credit payment</Link></>}
        </section>
      </div>

      <Modal open={modal === 'approve'} onClose={() => setModal(null)} title={f.decision === 'approved' ? 'Approve partner' : 'Reject application'} footer={<Button variant={f.decision === 'approved' ? 'primary' : 'danger'} busy={busy} onClick={() => call(() => api.post(`/admin/users/${u.id}/approval`, { decision: f.decision, ...(f.decision === 'approved' ? { creditLimit: f.creditLimit ? toPaise(f.creditLimit) : undefined, creditDays: Number(f.creditDays) } : { reason: f.reason }) }), f.decision === 'approved' ? 'Partner approved' : 'Application rejected')}>{f.decision === 'approved' ? 'Approve' : 'Reject'}</Button>}>
        {f.decision === 'approved' ? <div className="space-y-3"><Input label="Credit limit (₹, optional)" type="number" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} hint="Leave empty for prepaid only" /><Input label="Credit days" type="number" value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: e.target.value })} /></div>
          : <Input label="Reason (sent to the applicant)" value={f.reason} onChange={(e) => setF({ ...f, reason: e.target.value })} />}
      </Modal>
      <Modal open={modal === 'pw'} onClose={() => setModal(null)} title="Set a new password" footer={<Button busy={busy} onClick={() => call(() => api.post(`/admin/users/${u.id}/reset-password`, { password: f.password }), 'Password reset; share it securely')}>Set password</Button>}>
        <Input label="New password" type="text" value={f.password} onChange={(e) => setF({ ...f, password: e.target.value })} hint="They will be logged out of other devices." />
      </Modal>
      <Modal open={modal === 'edit'} onClose={() => setModal(null)} title="Edit account" footer={<Button busy={busy} onClick={saveEdit}>Save</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Contact name" value={f.name || ''} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Email" value={f.email || ''} onChange={(e) => setF({ ...f, email: e.target.value })} />
          {b2b && <>
            <Input className="sm:col-span-2" label="Business name" value={f.businessName} onChange={(e) => setF({ ...f, businessName: e.target.value })} />
            <Input label="GSTIN" value={f.gstin} onChange={(e) => setF({ ...f, gstin: e.target.value })} /><Input label="City" value={f.city} onChange={(e) => setF({ ...f, city: e.target.value })} />
            <div className="sm:col-span-2"><Checkbox label="Allow monthly credit" checked={f.creditEnabled} onChange={(e) => setF({ ...f, creditEnabled: e.target.checked })} /></div>
            <Input label="Credit limit (₹)" type="number" value={f.creditLimit} onChange={(e) => setF({ ...f, creditLimit: e.target.value })} /><Input label="Credit days" type="number" value={f.creditDays} onChange={(e) => setF({ ...f, creditDays: e.target.value })} />
            {u.role === 'distributor' && <><Input label="Agreement reference" value={f.agreementRef} onChange={(e) => setF({ ...f, agreementRef: e.target.value })} /><Input label="Agreement valid to" type="date" value={f.agreementValidTo} onChange={(e) => setF({ ...f, agreementValidTo: e.target.value })} /></>}
          </>}
          {u.delivery && <><Input label="Vehicle number" value={f.vehicleNumber} onChange={(e) => setF({ ...f, vehicleNumber: e.target.value })} /><Select label="Zone" placeholder="Any" value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })} options={(zones.data || []).map((z) => ({ value: z.id, label: z.name }))} /></>}
        </div>
      </Modal>
    </>
  );
}

export function CreditRequests() {
  const { data, reload } = useApi('/admin/credit-requests');
  const [d, setD] = useState(null);
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Credit requests" />
      <div className="panel">{data && <DataTable rows={data} empty="No credit requests" columns={[
        { key: 'name', label: 'Partner', render: (r) => <Link className="link" to={`/admin/users/${r.user_id}`}>{r.name}</Link> }, { key: 'role', label: 'Type', render: (r) => humanize(r.role) },
        { key: 'requested_limit', label: 'Requested', render: (r) => inr(r.requested_limit) }, { key: 'reason', label: 'Reason' }, { key: 'created_at', label: 'When', render: (r) => ago(r.created_at) },
        { key: 'status', label: 'Status', render: (r) => (r.status === 'pending' ? <button className="btn-primary btn-sm" onClick={() => setD({ ...r, approvedLimit: toRupees(r.requested_limit), creditDays: 30, note: '' })}>Decide</button> : <StatusBadge status={r.status} />) },
      ]} />}</div>
      <Modal open={!!d} onClose={() => setD(null)} title={`Credit for ${d?.name}`} footer={d && <>
        <Button variant="outline" busy={busy} onClick={() => run(async () => { await api.post(`/admin/credit-requests/${d.id}`, { decision: 'rejected', note: d.note }); toast('Rejected'); setD(null); reload(); })}>Reject</Button>
        <Button busy={busy} onClick={() => run(async () => { await api.post(`/admin/credit-requests/${d.id}`, { decision: 'approved', approvedLimit: toPaise(d.approvedLimit), creditDays: Number(d.creditDays), note: d.note }); toast('Credit approved'); setD(null); reload(); })}>Approve</Button>
      </>}>
        {d && <div className="space-y-3"><Input label="Approved limit (₹)" type="number" value={d.approvedLimit} onChange={(e) => setD({ ...d, approvedLimit: e.target.value })} /><Input label="Credit days" type="number" value={d.creditDays} onChange={(e) => setD({ ...d, creditDays: e.target.value })} /><Input label="Note to partner" value={d.note} onChange={(e) => setD({ ...d, note: e.target.value })} /></div>}
      </Modal>
    </>
  );
}

export function Admins() {
  const { data, reload } = useApi('/admin/admins');
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ role: 'admin' });
  const [run, busy] = useAction();
  return (
    <>
      <PageHeader title="Admin users"><button className="btn-primary" onClick={() => setOpen(true)}><Plus className="size-4" />Add admin</button></PageHeader>
      <div className="panel">{data && <DataTable rows={data} columns={[
        { key: 'name', label: 'Name', render: (r) => <Link className="link" to={`/admin/users/${r.id}`}>{r.name}</Link> }, { key: 'phone', label: 'Mobile' }, { key: 'email', label: 'Email' },
        { key: 'role', label: 'Role', render: (r) => <Badge tone={r.role === 'super_admin' ? 'dark' : 'aqua'}>{humanize(r.role)}</Badge> }, { key: 'last_login_at', label: 'Last login', render: (r) => (r.last_login_at ? ago(r.last_login_at) : 'Never') }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
      ]} />}</div>
      <p className="mt-3 text-sm text-ink-soft">Admins can do everything except manage admins and change system settings. Super admins can do both.</p>
      <Modal open={open} onClose={() => setOpen(false)} title="Add admin" footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/admin/admins', f); toast('Admin added'); setOpen(false); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Add</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Name" onChange={(e) => setF({ ...f, name: e.target.value })} /><Input label="Mobile" maxLength={10} onChange={(e) => setF({ ...f, phone: e.target.value })} />
          <Input label="Email" type="email" onChange={(e) => setF({ ...f, email: e.target.value })} /><Input label="Password" type="text" onChange={(e) => setF({ ...f, password: e.target.value })} />
          <Select label="Role" value={f.role} onChange={(e) => setF({ ...f, role: e.target.value })} options={[{ value: 'admin', label: 'Admin' }, { value: 'super_admin', label: 'Super admin' }]} />
        </div>
      </Modal>
    </>
  );
}

export { dateTime };
