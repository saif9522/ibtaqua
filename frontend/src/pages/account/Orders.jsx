import { useState } from 'react';
import { Link, useNavigate, useParams, useSearchParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Download, RotateCcw, Phone, Star, CheckCircle2, KeyRound } from 'lucide-react';
import { useApi, useAction } from '../../hooks/useApi';
import { useAuth, useSite } from '../../hooks/useSite';
import { api, download, errMsg } from '../../services/api';
import { cartActions, toast } from '../../redux/store';
import { payOnline } from '../../features/payments';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Pagination, Tabs, Button, Modal, Input, Textarea, Empty } from '../../components/ui';
import { inr, dateTime, date, humanize, ORDER_STEPS, imgUrl } from '../../utils/format';

export function OrderList() {
  const [status, setStatus] = useState('');
  const [page, setPage] = useState(1);
  const { data, loading, error, reload } = useApi(`/account/orders?page=${page}&limit=15${status ? `&status=${status}` : ''}`, { poll: 30000 });
  const navigate = useNavigate();
  const { isB2B } = useAuth();
  return (
    <>
      <PageHeader title="My orders">{isB2B && <Link to="/business/quick-order" className="btn-primary">Quick order</Link>}</PageHeader>
      <Tabs tabs={[{ value: '', label: 'All' }, 'pending', 'confirmed', 'out_for_delivery', 'delivered', 'cancelled']} value={status} onChange={(v) => { setStatus(v); setPage(1); }} />
      <div className="panel">
        {loading && !data && <Loading />}
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
        {data && (
          <DataTable rows={data.data} onRowClick={(r) => navigate(`/account/orders/${r.id}`)} empty="No orders yet"
            columns={[
              { key: 'order_number', label: 'Order', render: (r) => <span className="font-semibold text-depth">{r.order_number}</span> },
              { key: 'created_at', label: 'Placed', render: (r) => dateTime(r.created_at) },
              { key: 'summary', label: 'Items', render: (r) => <span className="line-clamp-1 max-w-xs text-ink-soft">{r.summary}</span> },
              { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total) },
              { key: 'payment_status', label: 'Payment', render: (r) => <StatusBadge status={r.payment_status} /> },
              { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            ]} />
        )}
        {data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}
      </div>
    </>
  );
}

function OfflinePayment({ order, onDone }) {
  const bank = useApi('/account/bank-details');
  const [ref, setRef] = useState('');
  const [run, busy] = useAction();
  const due = order.grand_total - order.amount_paid;
  const submit = (e) => { e.preventDefault(); run(async () => { try { await api.post('/account/payments/offline', { orderId: order.id, referenceNo: ref, amount: due, method: 'bank_transfer' }); toast('Submitted for verification'); onDone(); } catch (er) { toast(errMsg(er), 'danger'); } }); };
  const b = bank.data || {};
  return (
    <div className="rounded-[var(--radius-ctl)] bg-mist p-4 text-sm">
      <p className="font-semibold text-depth">Pay {inr(due)} by bank transfer</p>
      <dl className="mt-2 grid grid-cols-[auto_1fr] gap-x-4 gap-y-1">
        <dt className="text-ink-soft">Account name</dt><dd>{b.account_name || '—'}</dd>
        <dt className="text-ink-soft">Bank</dt><dd>{b.bank || '—'}</dd>
        <dt className="text-ink-soft">Account no.</dt><dd className="font-mono">{b.account_number || '—'}</dd>
        <dt className="text-ink-soft">IFSC</dt><dd className="font-mono">{b.ifsc || '—'}</dd>
        {b.upi_id && <><dt className="text-ink-soft">UPI</dt><dd>{b.upi_id}</dd></>}
      </dl>
      <form onSubmit={submit} className="mt-3 flex gap-2">
        <input className="input" placeholder="UTR / reference number" aria-label="Reference number" value={ref} onChange={(e) => setRef(e.target.value)} minLength={6} required />
        <Button busy={busy} className="shrink-0">Submit</Button>
      </form>
    </div>
  );
}

export function OrderDetail() {
  const { id } = useParams();
  const [sp] = useSearchParams();
  const { user } = useAuth();
  const site = useSite();
  const { data: o, loading, error, reload } = useApi(`/account/orders/${id}`, { poll: 20000 });
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [run, busy] = useAction();
  const [modal, setModal] = useState(null);
  const [text, setText] = useState('');
  const [review, setReview] = useState({ productId: null, rating: 5, comment: '' });

  if (loading && !o) return <Loading />;
  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  if (!o) return null;
  const idx = ORDER_STEPS.indexOf(o.status);
  const due = o.grand_total - o.amount_paid;
  const act = (fn, ok) => run(async () => { try { await fn(); if (ok) toast(ok); setModal(null); setText(''); reload(); } catch (e) { toast(errMsg(e), 'danger'); } });
  const reorder = () => run(async () => {
    const { data } = await api.get(`/account/orders/${o.id}/reorder`);
    dispatch(cartActions.replace(data.items.map((i) => { const it = o.items.find((x) => x.product_id === i.productId); return { ...i, name: it?.product_name, image: null }; })));
    navigate('/checkout');
  });

  return (
    <>
      <PageHeader title={`Order ${o.order_number}`} back="/account/orders" sub={`Placed ${dateTime(o.created_at)}`}>
        <StatusBadge status={o.status} />
        {o.invoice && <button className="btn-outline btn-sm" onClick={() => download(`/account/orders/${o.id}/invoice.pdf`, `${o.invoice.invoice_number.replace(/\//g, '-')}.pdf`)}><Download className="size-4" />Invoice</button>}
        <Button variant="outline" size="sm" onClick={reorder} busy={busy}><RotateCcw className="size-4" />Order again</Button>
      </PageHeader>
      {sp.get('placed') && <div className="mb-5 flex items-center gap-2 rounded-[var(--radius-ctl)] bg-ok-soft px-4 py-3 text-sm text-ok"><CheckCircle2 className="size-5" />Order placed. We've sent the details to your phone.</div>}

      <div className="grid gap-5 lg:grid-cols-[1.6fr_1fr]">
        <div className="space-y-5">
          {idx >= 0 && (
            <div className="panel p-5">
              <div className="flex gap-1">{ORDER_STEPS.map((s, i) => <div key={s} title={humanize(s)} className={`h-2 flex-1 rounded-full ${i <= idx ? 'bg-aqua' : 'bg-shoal'}`} />)}</div>
              <div className="mt-2 flex justify-between text-[12.5px] text-ink-soft"><span>Placed</span><span>Out for delivery</span><span>Delivered</span></div>
              {['dispatched', 'out_for_delivery'].includes(o.status) && o.delivery_otp && (
                <div className="mt-4 flex items-center gap-3 rounded-[var(--radius-ctl)] bg-depth px-4 py-3 text-white">
                  <KeyRound className="size-5 text-[#7fd6e8]" />
                  <p className="text-sm">Share this code with the delivery partner on arrival: <span className="ml-1 font-display text-2xl font-bold tracking-[0.2em]">{o.delivery_otp}</span></p>
                </div>
              )}
              {o.delivery && (
                <p className="mt-3 flex items-center gap-2 text-sm"><Phone className="size-4 text-aqua" />{o.delivery.staff_name}{o.delivery.vehicle_number ? ` · ${o.delivery.vehicle_number}` : ''}<a className="link" href={`tel:+91${o.delivery.staff_phone}`}>Call</a></p>
              )}
            </div>
          )}

          <div className="panel">
            <ul className="divide-y divide-shoal/70">
              {o.items.map((it) => (
                <li key={it.id} className="flex items-center gap-3 px-5 py-3">
                  <img src={imgUrl(null)} alt="" className="hidden size-12 rounded-lg bg-mist sm:block" />
                  <div className="flex-1"><p className="font-semibold">{it.product_name}</p><p className="text-sm text-ink-soft">{it.quantity} × {inr(it.unit_price)} · GST {Number(it.gst_percent)}%</p></div>
                  <div className="text-right">
                    <p className="font-semibold">{inr(it.line_total)}</p>
                    {o.status === 'delivered' && <button className="mt-1 inline-flex items-center gap-1 text-[13px] font-semibold text-aqua-700" onClick={() => { setReview({ productId: it.product_id, rating: 5, comment: '' }); setModal('review'); }}><Star className="size-3.5" />Review</button>}
                  </div>
                </li>
              ))}
            </ul>
            <dl className="space-y-1 border-t border-shoal px-5 py-4 text-sm">
              <div className="flex justify-between"><dt className="text-ink-soft">Taxable value</dt><dd>{inr(o.taxable_total)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">GST</dt><dd>{inr(o.gst_total)}</dd></div>
              {o.discount_total > 0 && <div className="flex justify-between text-ok"><dt>Discount</dt><dd>−{inr(o.discount_total)}</dd></div>}
              <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{o.delivery_charge ? inr(o.delivery_charge) : 'Free'}</dd></div>
              {o.jar_deposit_total > 0 && <div className="flex justify-between"><dt className="text-ink-soft">Jar deposit</dt><dd>{inr(o.jar_deposit_total)}</dd></div>}
              <div className="flex justify-between pt-1 text-base font-semibold"><dt>Total</dt><dd>{inr(o.grand_total)}</dd></div>
              <div className="flex justify-between"><dt className="text-ink-soft">Paid</dt><dd>{inr(o.amount_paid)}</dd></div>
            </dl>
          </div>

          <div className="panel p-5">
            <h2 className="text-lg">Timeline</h2>
            <ol className="mt-3 space-y-3 border-l-2 border-shoal pl-4">
              {o.timeline.slice().reverse().map((t) => <li key={t.id} className="text-sm"><p className="font-semibold text-depth">{humanize(t.to_status)}</p><p className="text-ink-soft">{dateTime(t.created_at)}{t.note ? ` · ${t.note}` : ''}</p></li>)}
            </ol>
          </div>
        </div>

        <div className="space-y-5">
          <div className="panel p-5 text-sm">
            <h2 className="text-lg">Payment</h2>
            <p className="mt-1"><StatusBadge status={o.payment_status} /> <span className="ml-1 text-ink-soft">{humanize(o.payment_method)}{o.due_date ? ` · due ${date(o.due_date)}` : ''}</span></p>
            {due > 0 && !['cancelled', 'returned'].includes(o.status) && o.payment_status !== 'pending_verification' && (
              <div className="mt-4 space-y-3">
                {['razorpay', 'upi', 'cod'].includes(o.payment_method) && <Button className="w-full" busy={busy} onClick={() => act(async () => payOnline(o.id, user), 'Payment received')}>Pay {inr(due)} online</Button>}
                {['bank_transfer', 'credit'].includes(o.payment_method) && <OfflinePayment order={o} onDone={reload} />}
              </div>
            )}
            {o.payments.length > 0 && <ul className="mt-4 space-y-1 border-t border-shoal pt-3">{o.payments.map((p) => <li key={p.id} className="flex justify-between"><span>{humanize(p.method)} · <StatusBadge status={p.status} /></span><span>{inr(p.amount)}</span></li>)}</ul>}
          </div>
          <div className="panel p-5 text-sm">
            <h2 className="text-lg">Delivery</h2>
            <p className="mt-2">{o.address?.contact_name} · {o.address?.contact_phone}</p>
            <p className="text-ink-soft">{[o.address?.line1, o.address?.line2, o.address?.landmark, o.address?.city, o.address?.pincode].filter(Boolean).join(', ')}</p>
            {o.delivery_date && <p className="mt-2">{date(o.delivery_date)} · {o.delivery_slot}</p>}
          </div>
          <div className="flex flex-wrap gap-2">
            {(site.buyer_cancellable_statuses || ['pending', 'confirmed']).includes(o.status) && <button className="btn-outline btn-sm" onClick={() => setModal('cancel')}>Cancel order</button>}
            {o.status === 'delivered' && <button className="btn-outline btn-sm" onClick={() => setModal('return')}>Request a return</button>}
            <button className="btn-outline btn-sm" onClick={() => setModal('help')}>Get help with this order</button>
          </div>
          {o.returnRequest && <p className="text-sm text-ink-soft">Return request: <StatusBadge status={o.returnRequest.status} /> {o.returnRequest.admin_note}</p>}
        </div>
      </div>

      <Modal open={modal === 'cancel'} onClose={() => setModal(null)} title="Cancel this order?" footer={<><button className="btn-ghost" onClick={() => setModal(null)}>Keep order</button><Button variant="danger" busy={busy} onClick={() => act(() => api.post(`/account/orders/${o.id}/cancel`, { reason: text }), 'Order cancelled')}>Cancel order</Button></>}>
        <Input label="Reason (optional)" value={text} onChange={(e) => setText(e.target.value)} />
        {o.amount_paid > 0 && <p className="mt-3 text-sm text-ink-soft">You've paid {inr(o.amount_paid)}. We'll refund it to the original payment method.</p>}
      </Modal>
      <Modal open={modal === 'return'} onClose={() => setModal(null)} title="Request a return" footer={<Button busy={busy} disabled={text.trim().length < 5} onClick={() => act(() => api.post(`/account/orders/${o.id}/return`, { reason: text }), 'Return requested')}>Send request</Button>}>
        <Textarea label="What went wrong?" value={text} onChange={(e) => setText(e.target.value)} hint={`Returns are accepted within ${site.return_window_days || 2} days of delivery.`} />
      </Modal>
      <Modal open={modal === 'help'} onClose={() => setModal(null)} title="Get help" footer={<Button busy={busy} disabled={text.trim().length < 5} onClick={() => act(() => api.post('/account/tickets', { subject: `Help with ${o.order_number}`, message: text, category: 'delivery', orderId: o.id }), 'Request sent. We will reply soon.')}>Send</Button>}>
        <Textarea label="Tell us what you need" value={text} onChange={(e) => setText(e.target.value)} />
      </Modal>
      <Modal open={modal === 'review'} onClose={() => setModal(null)} title="Review this product" footer={<Button busy={busy} onClick={() => act(() => api.post('/account/reviews', review), 'Thanks for your review')}>Submit review</Button>}>
        <div className="flex gap-1" role="radiogroup" aria-label="Rating">{[1, 2, 3, 4, 5].map((n) => <button key={n} role="radio" aria-checked={review.rating === n} aria-label={`${n} stars`} onClick={() => setReview({ ...review, rating: n })}><Star className={`size-8 ${n <= review.rating ? 'fill-marigold text-marigold' : 'text-shoal'}`} /></button>)}</div>
        <Textarea className="mt-3" label="Comment (optional)" value={review.comment} onChange={(e) => setReview({ ...review, comment: e.target.value })} />
      </Modal>
    </>
  );
}

export function EmptyOrders() { return <Empty title="No orders yet" action={<Link className="btn-primary" to="/shop">Shop water</Link>} />; }
