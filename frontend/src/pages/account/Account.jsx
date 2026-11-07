import { useState } from 'react';
import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Pencil, Trash2, Plus, Repeat, Pause, Play, X } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useSite';
import { api, errMsg } from '../../services/api';
import { setUser, toast } from '../../redux/store';
import AddressForm from '../../features/AddressForm';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Button, Modal, Input, Select, Textarea, Empty, Stat, Badge } from '../../components/ui';
import { inr, dateTime, date, humanize, ago, todayISO } from '../../utils/format';

export function Overview() {
  const { user } = useAuth();
  const orders = useApi('/account/orders?limit=5');
  const subs = useApi('/account/subscriptions');
  const jars = useApi('/account/jars');
  const active = orders.data?.data.filter((o) => !['delivered', 'cancelled', 'returned'].includes(o.status)) || [];
  return (
    <>
      <PageHeader title={`Hello, ${user.name.split(' ')[0]}`} sub="Your orders, deliveries and jar balance in one place.">
        <Link className="btn-primary" to="/shop">Order water</Link>
      </PageHeader>
      <div className="panel grid grid-cols-2 divide-x divide-shoal sm:grid-cols-4">
        <Stat label="Orders in progress" value={active.length} />
        <Stat label="Active subscriptions" value={subs.data?.filter((s) => s.status === 'active').length ?? '—'} />
        <Stat label="Empty jars with you" value={jars.data?.balance.jars_pending ?? '—'} tone={jars.data?.balance.jars_pending > 5 ? 'warn' : undefined} />
        <Stat label="Jar deposit held" value={jars.data ? inr(jars.data.balance.deposit_held) : '—'} />
      </div>
      <h2 className="mb-3 mt-8 text-xl">Recent orders</h2>
      <div className="panel">
        {orders.data && <DataTable rows={orders.data.data} empty="You haven't ordered yet"
          columns={[
            { key: 'order_number', label: 'Order', render: (r) => <Link to={`/account/orders/${r.id}`} className="link">{r.order_number}</Link> },
            { key: 'created_at', label: 'Placed', render: (r) => ago(r.created_at) },
            { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
          ]} />}
      </div>
    </>
  );
}

export function Addresses() {
  const { data, loading, reload } = useApi('/account/addresses');
  const [edit, setEdit] = useState(null);
  const remove = async (id) => { if (!window.confirm('Delete this address?')) return; try { await api.delete(`/account/addresses/${id}`); reload(); } catch (e) { toast(errMsg(e), 'danger'); } };
  return (
    <>
      <PageHeader title="Addresses"><button className="btn-primary" onClick={() => setEdit({})}><Plus className="size-4" />Add address</button></PageHeader>
      {loading && <Loading />}
      {data && !data.length && <Empty title="No saved addresses" action={<button className="btn-primary" onClick={() => setEdit({})}>Add address</button>} />}
      <div className="grid gap-4 sm:grid-cols-2">
        {data?.map((a) => (
          <div key={a.id} className="panel p-5">
            <div className="flex items-start justify-between gap-2">
              <p className="font-semibold text-depth">{a.label} {a.is_default ? <Badge tone="aqua">Default</Badge> : null}</p>
              <div className="flex gap-1">
                <button className="btn-ghost btn-sm" onClick={() => setEdit(a)} aria-label="Edit"><Pencil className="size-4" /></button>
                <button className="btn-ghost btn-sm" onClick={() => remove(a.id)} aria-label="Delete"><Trash2 className="size-4" /></button>
              </div>
            </div>
            <p className="mt-1 text-sm">{a.contact_name} · {a.contact_phone}</p>
            <p className="text-sm text-ink-soft">{[a.line1, a.line2, a.landmark, a.city, a.state, a.pincode].filter(Boolean).join(', ')}</p>
            {!a.zone_id && <p className="mt-2 text-sm font-semibold text-danger">We don't deliver to this pincode yet</p>}
          </div>
        ))}
      </div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit address' : 'New address'} wide>
        {edit && <AddressForm initial={edit.id ? edit : null} onCancel={() => setEdit(null)} onSaved={() => { setEdit(null); reload(); toast('Address saved'); }} />}
      </Modal>
    </>
  );
}

const DAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
export function Subscriptions() {
  const { isB2B } = useAuth();
  const { data, loading, reload } = useApi('/account/subscriptions');
  const products = useApi('/products?limit=100');
  const addresses = useApi('/account/addresses');
  const [open, setOpen] = useState(false);
  const [hist, setHist] = useState(null);
  const [f, setF] = useState({ productId: '', quantity: 1, frequency: 'daily', customWeekdays: [], addressId: '', deliverySlot: '', paymentMethod: 'cod', startDate: todayISO(), endDate: '' });
  const [run, busy] = useAction();
  const create = () => run(async () => {
    try {
      await api.post('/account/subscriptions', { ...f, productId: Number(f.productId), addressId: Number(f.addressId || addresses.data?.[0]?.id), quantity: Number(f.quantity), endDate: f.endDate || undefined, deliverySlot: f.deliverySlot || undefined });
      toast('Subscription started'); setOpen(false); reload();
    } catch (e) { toast(errMsg(e), 'danger'); }
  });
  const act = (id, action) => run(async () => { try { await api.post(`/account/subscriptions/${id}/${action}`, {}); toast(`Subscription ${action === 'pause' ? 'paused' : action === 'resume' ? 'resumed' : 'cancelled'}`); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  const showHist = async (s) => setHist({ s, rows: (await api.get(`/account/subscriptions/${s.id}/history`)).data });
  const freq = (s) => (s.frequency === 'custom' ? JSON.parse(s.custom_weekdays || '[]').map((d) => DAYS[d]).join(', ') : humanize(s.frequency));
  return (
    <>
      <PageHeader title="Subscriptions" sub="Regular deliveries are booked automatically a day ahead. Pause any time."><button className="btn-primary" onClick={() => setOpen(true)}><Repeat className="size-4" />New subscription</button></PageHeader>
      {loading && <Loading />}
      {data && !data.length && <Empty title="No subscriptions" action={<button className="btn-primary" onClick={() => setOpen(true)}>Start one</button>}>Get 20L jars or cases delivered daily, every other day, weekly or on days you choose.</Empty>}
      <div className="grid gap-4 md:grid-cols-2">
        {data?.map((s) => (
          <div key={s.id} className="panel p-5">
            <div className="flex items-start justify-between gap-2"><p className="font-semibold text-depth">{s.quantity} × {s.product_name}</p><StatusBadge status={s.status} /></div>
            <p className="mt-1 text-sm text-ink-soft">{freq(s)} · {s.delivery_slot || 'Any time'} · {s.address_label}</p>
            <p className="text-sm text-ink-soft">{s.status === 'active' ? `Next delivery ${date(s.next_run_date)}` : s.status === 'paused' ? `Paused${s.paused_until ? ` until ${date(s.paused_until)}` : ''}` : 'Cancelled'} · Pay by {humanize(s.payment_method)}</p>
            <div className="mt-3 flex flex-wrap gap-2">
              {s.status === 'active' && <Button variant="outline" size="sm" busy={busy} onClick={() => act(s.id, 'pause')}><Pause className="size-4" />Pause</Button>}
              {s.status === 'paused' && <Button variant="outline" size="sm" busy={busy} onClick={() => act(s.id, 'resume')}><Play className="size-4" />Resume</Button>}
              {s.status !== 'cancelled' && <Button variant="ghost" size="sm" busy={busy} onClick={() => window.confirm('Cancel this subscription?') && act(s.id, 'cancel')}><X className="size-4" />Cancel</Button>}
              <button className="btn-ghost btn-sm" onClick={() => showHist(s)}>History</button>
            </div>
          </div>
        ))}
      </div>
      <Modal open={open} onClose={() => setOpen(false)} title="New subscription" footer={<Button busy={busy} disabled={!f.productId} onClick={create}>Start subscription</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select className="sm:col-span-2" label="Product" placeholder="Choose a product" value={f.productId} onChange={(e) => setF({ ...f, productId: e.target.value, quantity: products.data?.data.find((p) => p.id === Number(e.target.value))?.price?.minOrderQty || 1 })}
            options={(products.data?.data || []).filter((p) => p.price).map((p) => ({ value: p.id, label: `${p.name} · ${inr(p.price.unitPrice)}` }))} />
          <Input label="Quantity each time" type="number" min={1} value={f.quantity} onChange={(e) => setF({ ...f, quantity: e.target.value })} />
          <Select label="How often" value={f.frequency} onChange={(e) => setF({ ...f, frequency: e.target.value })} options={[{ value: 'daily', label: 'Every day' }, { value: 'alternate', label: 'Every other day' }, { value: 'weekly', label: 'Every week' }, { value: 'monthly', label: 'Every month' }, { value: 'custom', label: 'On chosen weekdays' }]} />
          {f.frequency === 'custom' && (
            <div className="sm:col-span-2"><p className="label">Days</p><div className="flex flex-wrap gap-1.5">{DAYS.map((d, i) => { const on = f.customWeekdays.includes(i); return <button type="button" key={d} aria-pressed={on} onClick={() => setF({ ...f, customWeekdays: on ? f.customWeekdays.filter((x) => x !== i) : [...f.customWeekdays, i] })} className={`rounded-full px-3 py-1.5 text-sm font-semibold ${on ? 'bg-aqua text-white' : 'bg-mist'}`}>{d}</button>; })}</div></div>
          )}
          <Select className="sm:col-span-2" label="Deliver to" value={f.addressId} onChange={(e) => setF({ ...f, addressId: e.target.value })} options={(addresses.data || []).map((a) => ({ value: a.id, label: `${a.label}: ${a.line1}` }))} />
          <Input label="Start on" type="date" min={todayISO()} value={f.startDate} onChange={(e) => setF({ ...f, startDate: e.target.value })} />
          <Input label="End on (optional)" type="date" value={f.endDate} onChange={(e) => setF({ ...f, endDate: e.target.value })} />
          <Input label="Preferred slot" placeholder="7 AM – 10 AM" value={f.deliverySlot} onChange={(e) => setF({ ...f, deliverySlot: e.target.value })} />
          <Select label="Pay by" value={f.paymentMethod} onChange={(e) => setF({ ...f, paymentMethod: e.target.value })} options={[{ value: 'cod', label: 'Cash on delivery' }, ...(isB2B ? [{ value: 'credit', label: 'Monthly credit' }] : [])]} />
        </div>
      </Modal>
      <Modal open={!!hist} onClose={() => setHist(null)} title="Subscription history" wide>
        {hist && <DataTable rows={hist.rows} empty="No deliveries generated yet" columns={[
          { key: 'scheduled_date', label: 'Date', render: (r) => date(r.scheduled_date) },
          { key: 'order_number', label: 'Order', render: (r) => (r.order_id ? <Link className="link" to={`/account/orders/${r.order_id}`}>{r.order_number}</Link> : '—') },
          { key: 'status', label: 'Result', render: (r) => (r.status === 'failed' ? <span className="text-danger">{r.note}</span> : <StatusBadge status={r.order_status} />) },
          { key: 'grand_total', label: 'Amount', render: (r) => (r.grand_total ? inr(r.grand_total) : '—') },
        ]} />}
      </Modal>
    </>
  );
}

export function Support() {
  const { data, reload } = useApi('/account/tickets');
  const [open, setOpen] = useState(null);
  const [newT, setNewT] = useState(false);
  const [f, setF] = useState({ subject: '', message: '', category: 'general' });
  const [reply, setReply] = useState('');
  const [run, busy] = useAction();
  const openTicket = async (id) => setOpen((await api.get(`/account/tickets/${id}`)).data);
  return (
    <>
      <PageHeader title="Support" sub="Raise a complaint or ask a question. We reply here and by SMS."><button className="btn-primary" onClick={() => setNewT(true)}>New request</button></PageHeader>
      <div className="panel">
        {data && <DataTable rows={data} onRowClick={(r) => openTicket(r.id)} empty="No support requests" columns={[
          { key: 'ticket_number', label: 'Ticket' }, { key: 'subject', label: 'Subject' }, { key: 'category', label: 'Type', render: (r) => humanize(r.category) },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'updated_at', label: 'Updated', render: (r) => ago(r.updated_at) },
        ]} />}
      </div>
      <Modal open={newT} onClose={() => setNewT(false)} title="New support request" footer={<Button busy={busy} onClick={() => run(async () => { try { await api.post('/account/tickets', f); toast('Request sent'); setNewT(false); setF({ subject: '', message: '', category: 'general' }); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Send</Button>}>
        <div className="space-y-3">
          <Select label="Type" value={f.category} onChange={(e) => setF({ ...f, category: e.target.value })} options={['general', 'complaint', 'delivery', 'payment', 'quality', 'sales', 'credit']} />
          <Input label="Subject" value={f.subject} onChange={(e) => setF({ ...f, subject: e.target.value })} />
          <Textarea label="Details" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} />
        </div>
      </Modal>
      <Modal open={!!open} onClose={() => setOpen(null)} title={open?.subject || ''} wide footer={open && open.status !== 'closed' && <form className="flex w-full gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post(`/account/tickets/${open.id}/messages`, { message: reply }); setReply(''); openTicket(open.id); }); }}><input className="input" value={reply} onChange={(e) => setReply(e.target.value)} placeholder="Write a reply" aria-label="Reply" required /><Button busy={busy}>Send</Button></form>}>
        {open && <div className="space-y-3">{open.messages.map((m) => <div key={m.id} className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.is_staff ? 'bg-mist' : 'ml-auto bg-[#dff3f8]'}`}><p className="text-[12px] font-semibold text-ink-soft">{m.is_staff ? 'IBT AQUA team' : 'You'} · {dateTime(m.created_at)}</p><p className="whitespace-pre-line">{m.message}</p></div>)}</div>}
      </Modal>
    </>
  );
}

export function Notifications({ url = '/account/notifications' }) {
  const { data, reload } = useApi(url);
  const readAll = async () => { await api.post(`${url}/read`, {}); reload(); };
  return (
    <>
      <PageHeader title="Notifications"><button className="btn-outline btn-sm" onClick={readAll}>Mark all as read</button></PageHeader>
      <div className="panel divide-y divide-shoal/70">
        {data && !data.data.length && <Empty title="You're all caught up" />}
        {data?.data.map((n) => (
          <div key={n.id} className={`flex gap-3 px-5 py-3.5 ${n.is_read ? '' : 'bg-mist/60'}`}>
            {!n.is_read && <span className="mt-2 size-2 shrink-0 rounded-full bg-aqua" aria-label="Unread" />}
            <div className="flex-1"><p className="font-semibold text-depth">{n.title}</p>{n.body && <p className="text-sm text-ink-soft">{n.body}</p>}</div>
            <span className="shrink-0 text-[12.5px] text-ink-soft">{ago(n.created_at)}</span>
          </div>
        ))}
      </div>
    </>
  );
}

export function Jars() {
  const { data } = useApi('/account/jars');
  if (!data) return <Loading />;
  const b = data.balance;
  return (
    <>
      <PageHeader title="Jar balance" sub="20 litre jars are returnable. Hand over empties at each delivery to keep your balance low." />
      <div className="panel grid grid-cols-2 divide-x divide-shoal sm:grid-cols-4">
        <Stat label="Jars delivered" value={b.jars_delivered} /><Stat label="Jars returned" value={b.jars_returned} />
        <Stat label="Empty jars with you" value={b.jars_pending} tone={b.jars_pending > 5 ? 'warn' : undefined} /><Stat label="Deposit held" value={inr(b.deposit_held)} note={data.depositPerJar ? `${inr(data.depositPerJar)} per jar` : undefined} />
      </div>
      <h2 className="mb-3 mt-8 text-xl">History</h2>
      <div className="panel"><DataTable rows={data.history} empty="No jar activity yet" columns={[
        { key: 'created_at', label: 'Date', render: (r) => dateTime(r.created_at) }, { key: 'type', label: 'Activity', render: (r) => humanize(r.type) },
        { key: 'jars', label: 'Jars' }, { key: 'amount', label: 'Amount', render: (r) => (r.amount ? inr(r.amount) : '—') }, { key: 'note', label: 'Note' },
      ]} /></div>
    </>
  );
}

export function Profile() {
  const { user } = useAuth();
  const dispatch = useDispatch();
  const [f, setF] = useState({ name: user.name, email: user.email || '' });
  const [pw, setPw] = useState({ currentPassword: '', newPassword: '' });
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  return (
    <>
      <PageHeader title="Profile" />
      <div className="grid gap-5 lg:grid-cols-2">
        <form className="panel space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); run(async () => { try { const r = await api.patch('/auth/me', f); dispatch(setUser(r.data.user)); toast('Profile saved'); } catch (er) { toast(errMsg(er), 'danger'); } }); }}>
          <h2 className="text-lg">Your details</h2>
          <Input label="Name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} />
          <Input label="Mobile" value={user.phone} disabled hint="Contact support to change your mobile number" />
          <Input label="Email" type="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} />
          <Button busy={busy}>Save</Button>
        </form>
        <form className="panel space-y-3 p-5" onSubmit={(e) => { e.preventDefault(); setErr(null); run(async () => { try { await api.post('/auth/me/password', pw); toast('Password updated'); setPw({ currentPassword: '', newPassword: '' }); } catch (er) { setErr(errMsg(er)); } }); }}>
          <h2 className="text-lg">{user.role === 'customer' ? 'Set a password (optional)' : 'Change password'}</h2>
          {user.role !== 'customer' && <Input label="Current password" type="password" autoComplete="current-password" value={pw.currentPassword} onChange={(e) => setPw({ ...pw, currentPassword: e.target.value })} />}
          <Input label="New password" type="password" autoComplete="new-password" hint="At least 8 characters with a letter and a number" value={pw.newPassword} onChange={(e) => setPw({ ...pw, newPassword: e.target.value })} />
          <ErrorNote>{err}</ErrorNote>
          <Button busy={busy}>Update password</Button>
        </form>
      </div>
    </>
  );
}
