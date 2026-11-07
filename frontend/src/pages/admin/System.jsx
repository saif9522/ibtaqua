import { useEffect, useRef, useState } from 'react';
import { Link, useSearchParams } from 'react-router-dom';
import { Plus, Send, Upload, Star, Database } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { api, errMsg } from '../../services/api';
import { toast } from '../../redux/store';
import { useAuth } from '../../hooks/useSite';
import { PageHeader, Loading, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Tabs, Textarea, Checkbox, ErrorNote, Badge } from '../../components/ui';
import { Notifications as Inbox } from '../account/Account';
import { inr, dateTime, humanize, ago, toPaise } from '../../utils/format';

export function NotificationsAdmin() {
  const [tab, setTab] = useState('inbox');
  const [f, setF] = useState({ roles: ['customer'], title: '', body: '', type: 'promotion' });
  const outbox = useApi(tab === 'outbox' ? '/admin/notification-outbox' : null);
  const [run, busy] = useAction();
  return (
    <>
      <Tabs tabs={[{ value: 'inbox', label: 'My alerts' }, { value: 'send', label: 'Send a message' }, { value: 'outbox', label: 'SMS / WhatsApp / push log' }]} value={tab} onChange={setTab} />
      {tab === 'inbox' && <Inbox url="/admin/notifications" />}
      {tab === 'send' && (
        <div className="grid gap-5 lg:grid-cols-2">
          <div className="panel space-y-3 p-5">
            <h2 className="text-lg">Broadcast</h2>
            <div><p className="label">Send to</p><div className="flex flex-wrap gap-4">{['customer', 'retailer', 'wholesaler', 'distributor', 'delivery'].map((r) => <Checkbox key={r} label={humanize(r)} checked={f.roles.includes(r)} onChange={(e) => setF({ ...f, roles: e.target.checked ? [...f.roles, r] : f.roles.filter((x) => x !== r) })} />)}</div></div>
            <Select label="Kind" value={f.type} onChange={(e) => setF({ ...f, type: e.target.value })} options={['promotion', 'announcement', 'payment_due', 'subscription_reminder']} />
            <Input label="Title" value={f.title} onChange={(e) => setF({ ...f, title: e.target.value })} />
            <Textarea label="Message" value={f.body} onChange={(e) => setF({ ...f, body: e.target.value })} />
            <p className="text-[13px] text-ink-soft">Shown in the app. Push, SMS and WhatsApp follow the channel settings for this kind.</p>
            <Button busy={busy} disabled={!f.roles.length || f.title.length < 3} onClick={() => run(async () => { try { await api.post('/admin/notifications/broadcast', f); toast('Message sent'); setF({ ...f, title: '', body: '' }); } catch (e) { toast(errMsg(e), 'danger'); } })}><Send className="size-4" />Send</Button>
          </div>
          <div className="panel h-fit space-y-3 p-5">
            <h2 className="text-lg">Payment reminders</h2>
            <p className="text-sm text-ink-soft">Remind every business partner with credit orders that are due today or overdue.</p>
            <Button variant="outline" busy={busy} onClick={() => run(async () => { const r = await api.post('/admin/notifications/payment-reminders'); toast(`Reminders sent to ${r.data.sent} partners`); })}>Send payment reminders</Button>
          </div>
        </div>
      )}
      {tab === 'outbox' && <div className="panel">{outbox.data && <DataTable rows={outbox.data} empty="Nothing sent yet" columns={[
        { key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) }, { key: 'channel', label: 'Channel', render: (r) => humanize(r.channel) }, { key: 'recipient', label: 'To', render: (r) => <span className="font-mono text-[12.5px]">{r.recipient.slice(0, 24)}</span> },
        { key: 'payload', label: 'Message', render: (r) => <span className="line-clamp-1 max-w-sm">{JSON.parse(r.payload || '{}').title}</span> },
        { key: 'status', label: 'Status', render: (r) => <Badge tone={r.status === 'sent' ? 'ok' : r.status === 'failed' ? 'danger' : 'neutral'}>{r.status === 'skipped' ? 'Not configured' : humanize(r.status)}</Badge> }, { key: 'error', label: 'Error' },
      ]} />}</div>}
    </>
  );
}

function ImageField({ value, onChange }) {
  const ref = useRef();
  const [busy, setBusy] = useState(false);
  const up = async () => { const f = ref.current.files[0]; if (!f) return; setBusy(true); const fd = new FormData(); fd.append('image', f); try { onChange((await api.post('/admin/uploads/cms', fd)).data.path); } catch (e) { toast(errMsg(e), 'danger'); } setBusy(false); };
  return <div className="flex items-center gap-2">{value && <img src={value} alt="" className="size-12 rounded object-cover" />}<input ref={ref} type="file" accept="image/*" className="input py-2 text-sm" aria-label="Image" onChange={up} disabled={busy} /></div>;
}

export function Cms() {
  const [type, setType] = useState('banner');
  const { data, reload } = useApi(`/admin/cms?type=${type}`);
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const [err, setErr] = useState(null);
  const open = (r) => { setErr(null); setEdit(r ? { ...r, bodyText: type === 'page' ? r.body?.markdown || '' : type === 'faq' ? r.body?.answer || '' : JSON.stringify(r.body, null, 2) } : { type, slug: '', title: '', bodyText: type === 'section' ? '{}' : '', link: '', image: '', sort_order: 0, is_active: true }); };
  const save = () => run(async () => {
    setErr(null);
    let body;
    try { body = type === 'page' ? { markdown: edit.bodyText } : type === 'faq' ? { answer: edit.bodyText } : type === 'banner' ? { subtitle: edit.body?.subtitle ?? '', cta: edit.body?.cta ?? '', ctaLink: edit.link } : JSON.parse(edit.bodyText); } catch { return setErr('The content is not valid JSON.'); }
    if (type === 'banner') body = { subtitle: edit.subtitle ?? edit.body?.subtitle ?? '', cta: edit.cta ?? edit.body?.cta ?? '', ctaLink: edit.link };
    const payload = { type, slug: edit.slug || (edit.title || 'item').toLowerCase().replace(/[^a-z0-9]+/g, '-'), title: edit.title, body, image: edit.image || undefined, link: edit.link || undefined, sortOrder: Number(edit.sort_order || 0), isActive: !!edit.is_active };
    try { if (edit.id) await api.put(`/admin/cms/${edit.id}`, payload); else await api.post('/admin/cms', payload); toast('Saved'); setEdit(null); reload(); } catch (e) { setErr(errMsg(e)); }
  });
  return (
    <>
      <PageHeader title="Website content" sub="Banners, pages, FAQs and home page sections."><button className="btn-primary" onClick={() => open(null)}><Plus className="size-4" />Add</button></PageHeader>
      <Tabs tabs={[{ value: 'banner', label: 'Home banners' }, { value: 'section', label: 'Home sections' }, { value: 'page', label: 'Pages' }, { value: 'faq', label: 'FAQs' }]} value={type} onChange={setType} />
      <div className="panel">{data && <DataTable rows={data} onRowClick={open} columns={[
        { key: 'sort_order', label: '#' }, { key: 'title', label: 'Title', render: (r) => <b>{r.title}</b> }, { key: 'slug', label: type === 'page' ? 'URL' : 'Key', render: (r) => (type === 'page' ? `/page/${r.slug}` : r.slug) },
        { key: 'updated_at', label: 'Updated', render: (r) => ago(r.updated_at) }, { key: 'is_active', label: 'Visible', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
      ]} />}</div>
      <Modal open={!!edit} wide onClose={() => setEdit(null)} title={edit?.id ? `Edit ${edit.title}` : 'New item'} footer={<>{edit?.id && <Button variant="ghost" onClick={() => window.confirm('Delete?') && api.delete(`/admin/cms/${edit.id}`).then(() => { setEdit(null); reload(); })}>Delete</Button>}<Button busy={busy} onClick={save}>Save</Button></>}>
        {edit && <div className="grid gap-3 sm:grid-cols-2">
          <Input label="Title" value={edit.title || ''} onChange={(e) => setEdit({ ...edit, title: e.target.value })} />
          <Input label={type === 'page' ? 'URL slug' : 'Key'} value={edit.slug} onChange={(e) => setEdit({ ...edit, slug: e.target.value })} disabled={!!edit.id && ['page', 'section'].includes(type)} />
          {type === 'banner' && <>
            <Input className="sm:col-span-2" label="Subtitle" value={edit.subtitle ?? edit.body?.subtitle ?? ''} onChange={(e) => setEdit({ ...edit, subtitle: e.target.value })} />
            <Input label="Button text" value={edit.cta ?? edit.body?.cta ?? ''} onChange={(e) => setEdit({ ...edit, cta: e.target.value })} />
            <Input label="Button link" value={edit.link || ''} onChange={(e) => setEdit({ ...edit, link: e.target.value })} />
            <div className="sm:col-span-2"><p className="label">Image (optional)</p><ImageField value={edit.image} onChange={(image) => setEdit({ ...edit, image })} /></div>
          </>}
          {type !== 'banner' && <Textarea className="sm:col-span-2 font-mono" rows={type === 'faq' ? 4 : 14} label={type === 'page' ? 'Content (Markdown: # heading, **bold**, - list)' : type === 'faq' ? 'Answer' : 'Content (JSON)'} value={edit.bodyText} onChange={(e) => setEdit({ ...edit, bodyText: e.target.value })} />}
          <Input label="Order" type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} />
          <Checkbox label="Visible" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />
          <div className="sm:col-span-2"><ErrorNote>{err}</ErrorNote></div>
        </div>}
      </Modal>
    </>
  );
}

const MONEY_KEYS = ['cod_max_amount', 'jar_deposit_amount'];
function SettingField({ s, value, onChange }) {
  const v = value;
  if (typeof v === 'boolean') return <Checkbox label={s.description} checked={v} onChange={(e) => onChange(e.target.checked)} />;
  if (typeof v === 'number') {
    const money = MONEY_KEYS.includes(s.key);
    return <Input label={humanize(s.key)} hint={s.description} type="number" step={money ? '0.01' : '1'} value={money ? v / 100 : v} onChange={(e) => onChange(money ? toPaise(e.target.value) : Number(e.target.value))} />;
  }
  if (typeof v === 'string') return <Input label={humanize(s.key)} hint={s.description} value={v} onChange={(e) => onChange(e.target.value)} />;
  if (Array.isArray(v) && v.every((x) => typeof x === 'string')) return <Input label={humanize(s.key)} hint={`${s.description}. Separate with commas.`} value={v.join(', ')} onChange={(e) => onChange(e.target.value.split(',').map((x) => x.trim()).filter(Boolean))} />;
  if (v && typeof v === 'object' && !Array.isArray(v) && Object.values(v).every((x) => x === null || ['string', 'boolean', 'object'].includes(typeof x))) {
    return (
      <fieldset className="sm:col-span-2"><legend className="label">{humanize(s.key)}</legend><p className="mb-2 text-[12.5px] text-ink-soft">{s.description}</p>
        <div className="grid gap-3 sm:grid-cols-2">{Object.entries(v).map(([k, x]) => (typeof x === 'boolean'
          ? <Checkbox key={k} label={humanize(k)} checked={x} onChange={(e) => onChange({ ...v, [k]: e.target.checked })} />
          : x !== null && typeof x === 'object' || k.endsWith('location')
            ? <Input key={k} label={`${humanize(k)} (JSON, e.g. {"lat":24.03,"lng":84.07})`} defaultValue={x ? JSON.stringify(x) : ''} onBlur={(e) => { try { onChange({ ...v, [k]: e.target.value ? JSON.parse(e.target.value) : null }); } catch { toast('That is not valid JSON', 'danger'); } }} />
            : <Input key={k} label={humanize(k)} value={x ?? ''} onChange={(e) => onChange({ ...v, [k]: e.target.value })} />))}</div>
      </fieldset>
    );
  }
  return <JsonField s={s} value={v} onChange={onChange} />;
}
function JsonField({ s, value, onChange }) {
  const [t, setT] = useState(JSON.stringify(value, null, 2));
  const [bad, setBad] = useState(false);
  const isMoneyMap = ['min_order_value_by_tier', 'unit_costs'].includes(s.key);
  return <Textarea className="sm:col-span-2 font-mono" rows={6} label={humanize(s.key)} hint={`${s.description}${isMoneyMap ? ' (values in paise: ₹1 = 100)' : ''}`} error={bad ? 'Not valid JSON' : undefined} value={t} onChange={(e) => { setT(e.target.value); try { onChange(JSON.parse(e.target.value)); setBad(false); } catch { setBad(true); } }} />;
}

export function Settings() {
  const { can } = useAuth();
  const { data, reload } = useApi('/admin/settings');
  const [vals, setVals] = useState({});
  const [group, setGroup] = useState('business');
  const [run, busy] = useAction();
  useEffect(() => { if (data) setVals(Object.fromEntries(data.map((s) => [s.key, s.value]))); }, [data]);
  if (!data) return <Loading />;
  const groups = [...new Set(data.filter((s) => s.key !== 'demo_data_loaded').map((s) => s.group))];
  const changed = data.filter((s) => JSON.stringify(s.value) !== JSON.stringify(vals[s.key]));
  return (
    <>
      <PageHeader title="Settings" sub={can('settings.write') ? 'Business details, prices rules, payments, delivery and notifications.' : 'Only super admins can change settings.'}>
        {can('settings.write') && <Button variant="outline" busy={busy} onClick={() => run(async () => { const r = await api.post('/admin/backup'); toast(`Backup saved: ${r.data.file}`); })}><Database className="size-4" />Back up database</Button>}
        {can('settings.write') && <Button busy={busy} disabled={!changed.length} onClick={() => run(async () => { try { await api.put('/admin/settings', { values: Object.fromEntries(changed.map((s) => [s.key, vals[s.key]])) }); toast('Settings saved'); reload(); } catch (e) { toast(errMsg(e), 'danger'); } })}>Save {changed.length ? `${changed.length} change${changed.length > 1 ? 's' : ''}` : ''}</Button>}
      </PageHeader>
      <Tabs tabs={groups} value={group} onChange={setGroup} />
      <fieldset disabled={!can('settings.write')} className="panel grid gap-5 p-5 sm:grid-cols-2">
        {data.filter((s) => s.group === group).map((s) => <SettingField key={s.key} s={s} value={vals[s.key]} onChange={(v) => setVals({ ...vals, [s.key]: v })} />)}
      </fieldset>
      <p className="mt-3 text-[13px] text-ink-soft">API keys for Razorpay, SMS, WhatsApp, email and push live in the server's .env file, never here.</p>
    </>
  );
}

export function ActivityLogs() {
  const [page, setPage] = useState(1);
  const [entity, setEntity] = useState('');
  const { data } = useApi(`/admin/audit-logs?page=${page}&limit=50${entity ? `&entity=${entity}` : ''}`);
  const [show, setShow] = useState(null);
  return (
    <>
      <PageHeader title="Activity log" sub="Every admin change, who made it and when." />
      <select className="input mb-3 w-auto" aria-label="Filter" value={entity} onChange={(e) => { setEntity(e.target.value); setPage(1); }}><option value="">Everything</option>{['order', 'product', 'product_price', 'user', 'payment', 'batch', 'coupon', 'zone', 'settings', 'cms', 'return', 'subscription', 'credit_request', 'system'].map((x) => <option key={x} value={x}>{humanize(x)}</option>)}</select>
      <div className="panel">{data && <DataTable rows={data.data} onRowClick={setShow} columns={[
        { key: 'created_at', label: 'When', render: (r) => dateTime(r.created_at) }, { key: 'user_name', label: 'Who', render: (r) => r.user_name || 'System' },
        { key: 'action', label: 'Action', render: (r) => <span className="font-mono text-[12.5px]">{r.action}</span> }, { key: 'entity', label: 'On', render: (r) => (r.entity ? `${humanize(r.entity)}${r.entity_id ? ` #${r.entity_id}` : ''}` : '') }, { key: 'ip', label: 'IP' },
      ]} />}{data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}</div>
      <Modal open={!!show} onClose={() => setShow(null)} title={show?.action}><pre className="overflow-x-auto rounded bg-mist p-3 text-[12.5px]">{JSON.stringify(show?.meta, null, 2)}</pre></Modal>
    </>
  );
}

export function Support() {
  const [sp, setSp] = useSearchParams();
  const tab = sp.get('tab') || 'tickets';
  return (
    <>
      <PageHeader title="Support & feedback" />
      <Tabs tabs={[{ value: 'tickets', label: 'Tickets' }, { value: 'returns', label: 'Returns' }, { value: 'reviews', label: 'Reviews' }, { value: 'enquiries', label: 'Enquiries' }]} value={tab} onChange={(v) => setSp({ tab: v })} />
      {tab === 'tickets' && <Tickets />}{tab === 'returns' && <Returns />}{tab === 'reviews' && <Reviews />}{tab === 'enquiries' && <Enquiries />}
    </>
  );
}

function Tickets() {
  const [status, setStatus] = useState('open');
  const { data, reload } = useApi(`/admin/tickets?limit=50${status ? `&status=${status}` : ''}`);
  const [t, setT] = useState(null);
  const [f, setF] = useState({ message: '', status: 'in_progress' });
  const [run, busy] = useAction();
  const open = async (id) => setT((await api.get(`/admin/tickets/${id}`)).data);
  return (
    <>
      <select className="input mb-3 w-auto" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}><option value="">All</option>{['open', 'in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
      <div className="panel">{data && <DataTable rows={data.data} onRowClick={(r) => open(r.id)} empty="No tickets" columns={[
        { key: 'ticket_number', label: 'Ticket' }, { key: 'name', label: 'From', render: (r) => <>{r.name}<p className="text-[12px] text-ink-soft">{r.phone}</p></> }, { key: 'subject', label: 'Subject' },
        { key: 'category', label: 'Type', render: (r) => humanize(r.category) }, { key: 'priority', label: 'Priority', render: (r) => <Badge tone={r.priority === 'high' ? 'danger' : 'neutral'}>{humanize(r.priority)}</Badge> },
        { key: 'order_number', label: 'Order' }, { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> }, { key: 'updated_at', label: 'Updated', render: (r) => ago(r.updated_at) },
      ]} />}</div>
      <Modal open={!!t} wide onClose={() => setT(null)} title={t ? `${t.ticket_number} · ${t.subject}` : ''} footer={t && <form className="flex w-full flex-wrap gap-2" onSubmit={(e) => { e.preventDefault(); run(async () => { await api.post(`/admin/tickets/${t.id}/reply`, f); setF({ message: '', status: f.status }); open(t.id); reload(); }); }}>
        <input className="input min-w-60 flex-1" placeholder="Reply to the buyer" aria-label="Reply" value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} required />
        <select className="input w-auto" aria-label="Set status" value={f.status} onChange={(e) => setF({ ...f, status: e.target.value })}>{['in_progress', 'resolved', 'closed'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
        <Button busy={busy}>Send</Button>
      </form>}>
        {t && <div className="space-y-3">{t.messages.map((m) => <div key={m.id} className={`max-w-[85%] rounded-xl px-4 py-2.5 text-sm ${m.is_staff ? 'ml-auto bg-[#dff3f8]' : 'bg-mist'}`}><p className="text-[12px] font-semibold text-ink-soft">{m.name} · {dateTime(m.created_at)}</p><p className="whitespace-pre-line">{m.message}</p></div>)}</div>}
      </Modal>
    </>
  );
}

function Returns() {
  const { data, reload } = useApi('/admin/returns');
  const [r, setR] = useState(null);
  const [run, busy] = useAction();
  const decide = (decision) => run(async () => { try { const res = await api.post(`/admin/returns/${r.id}`, { decision, restock: r.restock, refundAmount: toPaise(r.refund), note: r.note }); toast(decision === 'approved' ? `Return approved${res.data.unrefunded ? `; ${inr(res.data.unrefunded)} still to refund manually` : ''}` : 'Return rejected'); setR(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  return (
    <div className="panel">{data && <DataTable rows={data} empty="No return requests" columns={[
      { key: 'order_number', label: 'Order', render: (x) => <Link className="link" to={`/admin/orders/${x.order_id}`}>{x.order_number}</Link> }, { key: 'name', label: 'Buyer' }, { key: 'reason', label: 'Reason' },
      { key: 'created_at', label: 'When', render: (x) => ago(x.created_at) }, { key: 'refund_amount', label: 'Refund', render: (x) => (x.refund_amount ? inr(x.refund_amount) : '—') },
      { key: 'status', label: 'Status', render: (x) => (x.status === 'requested' ? <button className="btn-primary btn-sm" onClick={() => setR({ ...x, restock: false, refund: x.amount_paid / 100, note: '' })}>Decide</button> : <StatusBadge status={x.status} />) },
    ]} />}
      <Modal open={!!r} onClose={() => setR(null)} title={`Return for ${r?.order_number}`} footer={r && <><Button variant="outline" busy={busy} onClick={() => decide('rejected')}>Reject</Button><Button busy={busy} onClick={() => decide('approved')}>Approve return</Button></>}>
        {r && <div className="space-y-3"><p className="text-sm">{r.reason}</p><Checkbox label="Units are sealed and sellable: put them back into stock" checked={r.restock} onChange={(e) => setR({ ...r, restock: e.target.checked })} /><Input label="Refund (₹)" type="number" step="0.01" value={r.refund} onChange={(e) => setR({ ...r, refund: e.target.value })} hint={`Paid on this order: ${inr(r.amount_paid)}`} /><Input label="Note to buyer" value={r.note} onChange={(e) => setR({ ...r, note: e.target.value })} /></div>}
      </Modal>
    </div>
  );
}

function Reviews() {
  const [status, setStatus] = useState('pending');
  const { data, reload } = useApi(`/admin/reviews?status=${status}`);
  const set = (id, s) => api.patch(`/admin/reviews/${id}`, { status: s }).then(() => { toast(`Review ${s}`); reload(); });
  return (
    <>
      <select className="input mb-3 w-auto" aria-label="Status" value={status} onChange={(e) => setStatus(e.target.value)}>{['pending', 'approved', 'rejected'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select>
      <div className="panel">{data && <DataTable rows={data} empty="No reviews here" columns={[
        { key: 'product_name', label: 'Product' }, { key: 'name', label: 'By' }, { key: 'rating', label: 'Rating', render: (r) => <span className="flex">{Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="size-3.5 fill-marigold text-marigold" />)}</span> },
        { key: 'comment', label: 'Comment', render: (r) => <span className="line-clamp-2 max-w-md">{r.comment}</span> }, { key: 'created_at', label: 'When', render: (r) => ago(r.created_at) },
        { key: 'a', label: '', render: (r) => <span className="flex gap-1">{r.status !== 'approved' && <button className="btn-ghost btn-sm text-ok" onClick={() => set(r.id, 'approved')}>Approve</button>}{r.status !== 'rejected' && <button className="btn-ghost btn-sm text-danger" onClick={() => set(r.id, 'rejected')}>Hide</button>}</span> },
      ]} />}</div>
    </>
  );
}

function Enquiries() {
  const { data, reload } = useApi('/admin/enquiries');
  return (
    <div className="panel">{data && <DataTable rows={data} empty="No enquiries" columns={[
      { key: 'created_at', label: 'When', render: (r) => ago(r.created_at) }, { key: 'type', label: 'Type', render: (r) => <Badge tone="aqua">{humanize(r.type)}</Badge> },
      { key: 'name', label: 'From', render: (r) => <>{r.name}{r.business_name ? ` · ${r.business_name}` : ''}<p className="text-[12px]"><a className="link" href={`tel:+91${r.phone}`}>{r.phone}</a>{r.email ? ` · ${r.email}` : ''}</p></> },
      { key: 'message', label: 'Message', render: (r) => <span className="line-clamp-3 max-w-md text-sm">{r.message}{r.details ? ` (${Object.entries(r.details).filter(([, v]) => v).map(([k, v]) => `${k}: ${v}`).join(', ')})` : ''}</span> },
      { key: 'status', label: 'Status', render: (r) => <select className="input w-auto py-1" aria-label="Status" value={r.status} onChange={(e) => api.patch(`/admin/enquiries/${r.id}`, { status: e.target.value }).then(reload)}>{['new', 'contacted', 'closed'].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</select> },
    ]} />}</div>
  );
}
