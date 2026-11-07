import { useState } from 'react';
import { Phone, Navigation, Package, PlayCircle, CheckCircle2, XCircle, Route } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { api, errMsg } from '../../services/api';
import { toast } from '../../redux/store';
import { PageHeader, Loading, ErrorNote, StatusBadge, Button, Modal, Input, Empty, Stat, DataTable, Badge } from '../../components/ui';
import { inr, dateTime, humanize, todayISO } from '../../utils/format';

export function DeliveryRun() {
  const { data, loading, error, reload } = useApi('/delivery/run?status=active', { poll: 30000 });
  const [done, setDone] = useState(null);
  const [failing, setFailing] = useState(null);
  const [f, setF] = useState({ otp: '', cash: '', jars: '' });
  const [reason, setReason] = useState('');
  const [run, busy] = useAction();
  const act = (fn, ok) => run(async () => { try { await fn(); toast(ok); setDone(null); setFailing(null); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });

  if (loading && !data) return <Loading label="Loading your run" />;
  return (
    <>
      <PageHeader title="Today's run" sub={data ? `${data.stops.length} stops · ${data.staff.vehicle_number || ''}` : ''}>
        {data?.routeUrl && <a href={data.routeUrl} target="_blank" rel="noreferrer" className="btn-primary"><Route className="size-4" />Open route in Maps</a>}
      </PageHeader>
      <ErrorNote onRetry={reload}>{error}</ErrorNote>
      {data && !data.stops.length && <Empty title="No deliveries assigned" icon={Package}>New assignments appear here automatically.</Empty>}
      <ol className="space-y-4">
        {data?.stops.map((s, i) => (
          <li key={s.id} className="panel overflow-hidden">
            <div className="flex items-start gap-3 p-4">
              <span className="grid size-9 shrink-0 place-items-center rounded-full bg-depth font-display font-bold text-white">{i + 1}</span>
              <div className="min-w-0 flex-1">
                <div className="flex flex-wrap items-center gap-2"><p className="font-semibold text-depth">{s.customer_name}</p><StatusBadge status={s.status} />{s.payment_method === 'cod' && s.amountDue > 0 && <Badge tone="warn">Collect {inr(s.amountDue)}</Badge>}</div>
                <p className="mt-0.5 text-sm text-ink-soft">{[s.address.line1, s.address.line2, s.address.landmark, s.address.city, s.address.pincode].filter(Boolean).join(', ')}</p>
                <p className="mt-1 text-sm">{s.items.map((it) => `${it.quantity} × ${it.product_name}`).join(', ')}</p>
                <p className="mt-1 text-[13px] text-ink-soft">{s.order_number} · {s.delivery_slot || 'Any time'}{s.jarsPending ? ` · ${s.jarsPending} empty ${s.jarsPending === 1 ? 'jar' : 'jars'} to collect` : ''}</p>
                {s.notes && <p className="mt-1 rounded bg-marigold-soft px-2 py-1 text-[13px] text-[#7a540e]">{s.notes}</p>}
              </div>
            </div>
            <div className="grid grid-cols-2 gap-px border-t border-shoal bg-shoal sm:grid-cols-4">
              <a href={`tel:+91${s.address.contact_phone || s.customer_phone}`} className="flex items-center justify-center gap-2 bg-white py-3 text-sm font-semibold text-depth"><Phone className="size-4" />Call</a>
              <a href={s.mapsUrl} target="_blank" rel="noreferrer" className="flex items-center justify-center gap-2 bg-white py-3 text-sm font-semibold text-depth"><Navigation className="size-4" />Navigate</a>
              {s.status === 'assigned' && <button className="col-span-2 flex items-center justify-center gap-2 bg-aqua py-3 text-sm font-semibold text-white" disabled={busy} onClick={() => act(() => api.post(`/delivery/assignments/${s.id}/pickup`), 'Picked up')}><Package className="size-4" />Picked up from plant</button>}
              {s.status === 'picked_up' && <button className="col-span-2 flex items-center justify-center gap-2 bg-aqua py-3 text-sm font-semibold text-white" disabled={busy} onClick={() => act(() => api.post(`/delivery/assignments/${s.id}/start`), 'Customer notified you are on the way')}><PlayCircle className="size-4" />Start delivery</button>}
              {s.status === 'out_for_delivery' && (
                <>
                  <button className="flex items-center justify-center gap-2 bg-ok py-3 text-sm font-semibold text-white" onClick={() => { setF({ otp: '', cash: s.payment_method === 'cod' ? String(s.amountDue / 100) : '', jars: '' }); setDone(s); }}><CheckCircle2 className="size-4" />Delivered</button>
                  <button className="flex items-center justify-center gap-2 bg-white py-3 text-sm font-semibold text-danger" onClick={() => { setReason(''); setFailing(s); }}><XCircle className="size-4" />Couldn't deliver</button>
                </>
              )}
            </div>
          </li>
        ))}
      </ol>

      <Modal open={!!done} onClose={() => setDone(null)} title={`Complete ${done?.order_number || ''}`} footer={<Button busy={busy} onClick={() => act(() => api.post(`/delivery/assignments/${done.id}/complete`, { otp: f.otp, cashCollected: Math.round(Number(f.cash || 0) * 100), emptyJarsCollected: Number(f.jars || 0) }), 'Delivery completed')}>Confirm delivery</Button>}>
        {done && (
          <div className="space-y-3">
            <Input label="Customer's 4-digit OTP" inputMode="numeric" maxLength={4} autoFocus value={f.otp} onChange={(e) => setF({ ...f, otp: e.target.value.replace(/\D/g, '') })} hint="The customer sees this code in their app or SMS." />
            <Input label="Cash collected (₹)" type="number" min={0} step="0.01" value={f.cash} onChange={(e) => setF({ ...f, cash: e.target.value })} hint={done.amountDue > 0 ? `Due: ${inr(done.amountDue)}` : 'Already paid online'} />
            {done.items.some((i) => i.is_returnable_jar) && <Input label="Empty jars collected" type="number" min={0} value={f.jars} onChange={(e) => setF({ ...f, jars: e.target.value })} hint={`Customer holds ${done.jarsPending} empty jars`} />}
          </div>
        )}
      </Modal>
      <Modal open={!!failing} onClose={() => setFailing(null)} title="Why couldn't you deliver?" footer={<Button variant="danger" busy={busy} disabled={reason.trim().length < 3} onClick={() => act(() => api.post(`/delivery/assignments/${failing.id}/fail`, { reason }), 'Marked as not delivered')}>Save</Button>}>
        <div className="mb-3 flex flex-wrap gap-2">{['Customer not reachable', 'Door locked', 'Customer refused', 'Wrong address', 'Vehicle issue'].map((r) => <button key={r} className={`rounded-full px-3 py-1.5 text-sm ${reason === r ? 'bg-depth text-white' : 'bg-mist'}`} onClick={() => setReason(r)}>{r}</button>)}</div>
        <Input label="Or describe" value={reason} onChange={(e) => setReason(e.target.value)} />
      </Modal>
    </>
  );
}

export function DeliveryHistory() {
  const [d, setD] = useState(todayISO());
  const report = useApi(`/delivery/report?date=${d}`);
  const hist = useApi('/delivery/run?status=history');
  const r = report.data;
  return (
    <>
      <PageHeader title="Daily report"><Input type="date" aria-label="Report date" value={d} max={todayISO()} onChange={(e) => setD(e.target.value)} /></PageHeader>
      {r && (
        <div className="panel grid grid-cols-2 divide-x divide-y divide-shoal sm:grid-cols-4 sm:divide-y-0">
          <Stat label="Delivered" value={r.delivered} /><Stat label="Not delivered" value={r.failed} tone={r.failed ? 'warn' : undefined} />
          <Stat label="Cash collected" value={inr(r.cashCollected)} note="Hand over at the plant" /><Stat label="Empty jars collected" value={r.emptyJarsCollected} />
        </div>
      )}
      <h2 className="mb-3 mt-8 text-xl">Recent deliveries</h2>
      <div className="panel">{hist.data && <DataTable rows={hist.data.stops.slice().reverse()} empty="No completed deliveries yet" columns={[
        { key: 'order_number', label: 'Order' }, { key: 'customer_name', label: 'Customer' },
        { key: 'status', label: 'Result', render: (s) => <StatusBadge status={s.status} /> },
        { key: 'delivered_at', label: 'When', render: (s) => dateTime(s.delivered_at || s.updated_at) },
        { key: 'cash_collected', label: 'Cash', render: (s) => (s.cash_collected ? inr(s.cash_collected) : '—') },
        { key: 'empty_jars_collected', label: 'Jars' }, { key: 'failure_reason', label: 'Note', render: (s) => s.failure_reason || humanize(s.notes) || '' },
      ]} />}</div>
    </>
  );
}
