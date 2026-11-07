import { useEffect, useMemo, useState } from 'react';
import { Link, Navigate, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { MapPin, Tag, X } from 'lucide-react';
import { api, errMsg } from '../../services/api';
import { useApi } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useSite';
import { cartActions, toast } from '../../redux/store';
import { Loading, ErrorNote, Button, QtyStepper, Modal } from '../../components/ui';
import AddressForm from '../../features/AddressForm';
import { payOnline } from '../../features/payments';
import { inr, imgUrl, todayISO } from '../../utils/format';

export default function Checkout() {
  const { user, isBuyer, status } = useAuth();
  const items = useSelector((s) => s.cart.items);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const addresses = useApi(isBuyer ? '/account/addresses' : null);
  const [addressId, setAddressId] = useState(null);
  const [adding, setAdding] = useState(false);
  const [coupon, setCoupon] = useState('');
  const [applied, setApplied] = useState('');
  const [method, setMethod] = useState(null);
  const [slot, setSlot] = useState('');
  const [deliveryDate, setDeliveryDate] = useState(todayISO());
  const [notes, setNotes] = useState('');
  const [quote, setQuote] = useState(null);
  const [qErr, setQErr] = useState(null);
  const [placing, setPlacing] = useState(false);

  useEffect(() => {
    if (addresses.data?.length && !addressId) setAddressId((addresses.data.find((a) => a.is_default) || addresses.data[0]).id);
  }, [addresses.data, addressId]);

  const key = useMemo(() => JSON.stringify([items.map((i) => [i.productId, i.quantity]), addressId, applied]), [items, addressId, applied]);
  useEffect(() => {
    if (!isBuyer || !items.length) return;
    let live = true;
    api.post('/account/checkout/quote', { items: items.map(({ productId, quantity }) => ({ productId, quantity })), addressId: addressId || undefined, couponCode: applied || undefined })
      .then((r) => { if (!live) return; setQuote(r.data); setQErr(null); if (!slot && r.data.deliverySlots?.length) setSlot(r.data.deliverySlots[0]); if (!method || !r.data.paymentMethods.find((m) => m.id === method)?.enabled) setMethod(r.data.paymentMethods.find((m) => m.enabled)?.id || null); })
      .catch((e) => { if (!live) return; setQErr(errMsg(e)); if (applied && /coupon/i.test(errMsg(e))) { setApplied(''); toast(errMsg(e), 'danger'); } });
    return () => { live = false; };
  }, [key]); // eslint-disable-line react-hooks/exhaustive-deps

  if (status === 'loading') return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: '/checkout' }} replace />;
  if (!isBuyer) return <div className="mx-auto max-w-xl p-10 text-center">Staff accounts cannot place orders here. <Link className="link" to="/admin/orders">Create an order from the admin panel</Link>.</div>;
  if (!items.length) return <div className="mx-auto max-w-xl px-4 py-20 text-center"><h1 className="text-3xl">Your cart is empty</h1><Link to="/shop" className="btn-primary mt-6">Browse water</Link></div>;

  const place = async () => {
    setPlacing(true);
    try {
      const { data: o } = await api.post('/account/orders', {
        items: items.map(({ productId, quantity }) => ({ productId, quantity })), addressId, paymentMethod: method, couponCode: applied || undefined,
        deliveryDate, deliverySlot: slot || undefined, notes: notes || undefined, source: 'web',
      });
      dispatch(cartActions.clear());
      if (o.nextStep === 'pay_online') {
        try { await payOnline(o.id, user); toast('Payment received. Thank you!'); } catch (e) { toast(e.message || 'Payment not completed', 'danger'); }
      }
      navigate(`/account/orders/${o.id}?placed=1`, { replace: true });
    } catch (e) { toast(errMsg(e), 'danger'); } finally { setPlacing(false); }
  };

  const s = quote?.summary;
  const selected = addresses.data?.find((a) => a.id === addressId);
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <h1 className="text-4xl">Checkout</h1>
      <div className="mt-6 grid gap-8 lg:grid-cols-[1.5fr_1fr]">
        <div className="space-y-6">
          <section className="panel p-5">
            <h2 className="text-xl">Deliver to</h2>
            {addresses.loading && <Loading />}
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              {addresses.data?.map((a) => (
                <label key={a.id} className={`flex cursor-pointer gap-3 rounded-[var(--radius-ctl)] border p-3 ${addressId === a.id ? 'border-aqua bg-mist' : 'border-shoal'}`}>
                  <input type="radio" name="addr" className="mt-1 accent-[var(--color-aqua)]" checked={addressId === a.id} onChange={() => setAddressId(a.id)} />
                  <span className="text-sm"><b className="text-depth">{a.label}</b> · {a.contact_name}<br />{a.line1}{a.line2 ? `, ${a.line2}` : ''}, {a.city} {a.pincode}{!a.zone_id && <span className="mt-1 block font-semibold text-danger">Outside delivery area</span>}</span>
                </label>
              ))}
              <button className="flex items-center justify-center gap-2 rounded-[var(--radius-ctl)] border border-dashed border-shoal p-3 text-sm font-semibold text-aqua-700 hover:border-aqua" onClick={() => setAdding(true)}><MapPin className="size-4" />Add a new address</button>
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="text-xl">When</h2>
            <div className="mt-3 grid gap-3 sm:grid-cols-2">
              <div><label className="label" htmlFor="dd">Delivery date</label><input id="dd" type="date" className="input" min={todayISO()} value={deliveryDate} onChange={(e) => setDeliveryDate(e.target.value)} /></div>
              <div><label className="label" htmlFor="slot">Time slot</label><select id="slot" className="input" value={slot} onChange={(e) => setSlot(e.target.value)}>{(quote?.deliverySlots || []).map((x) => <option key={x}>{x}</option>)}</select></div>
              <div className="sm:col-span-2"><label className="label" htmlFor="notes">Note for the delivery partner (optional)</label><input id="notes" className="input" maxLength={500} placeholder="e.g. Ring the bell twice, 2nd floor" value={notes} onChange={(e) => setNotes(e.target.value)} /></div>
            </div>
          </section>

          <section className="panel p-5">
            <h2 className="text-xl">Payment</h2>
            <div className="mt-3 space-y-2">
              {quote?.paymentMethods.map((m) => (
                <label key={m.id} className={`flex gap-3 rounded-[var(--radius-ctl)] border p-3 ${m.enabled ? 'cursor-pointer' : 'opacity-55'} ${method === m.id ? 'border-aqua bg-mist' : 'border-shoal'}`}>
                  <input type="radio" name="pay" className="mt-1 accent-[var(--color-aqua)]" disabled={!m.enabled} checked={method === m.id} onChange={() => setMethod(m.id)} />
                  <span className="text-sm"><b className="text-depth">{m.label}</b>{!m.enabled && m.reason && <span className="block text-ink-soft">{m.reason}</span>}</span>
                </label>
              ))}
            </div>
            {method === 'bank_transfer' && <p className="mt-3 text-sm text-ink-soft">After placing the order you'll see our bank details and can submit your UTR number for verification.</p>}
          </section>
        </div>

        <aside className="h-fit space-y-4 lg:sticky lg:top-24">
          <div className="panel p-5">
            <h2 className="text-xl">Order summary</h2>
            <ul className="mt-3 divide-y divide-shoal/70">
              {items.map((i) => {
                const q = quote?.items.find((x) => x.productId === i.productId);
                return (
                  <li key={i.productId} className="flex gap-3 py-3">
                    <img src={imgUrl(i.image)} alt="" className="size-12 rounded-lg bg-mist" />
                    <div className="flex-1 text-sm">
                      <p className="font-semibold leading-snug">{i.name}</p>
                      <div className="mt-1.5 flex items-center justify-between gap-2">
                        <QtyStepper value={i.quantity} min={i.minQty || 1} onChange={(n) => dispatch(cartActions.setQty({ productId: i.productId, quantity: n }))} />
                        <span className="font-semibold">{q ? inr(q.lineTotal + q.discount) : ''}</span>
                      </div>
                    </div>
                    <button onClick={() => dispatch(cartActions.remove(i.productId))} aria-label={`Remove ${i.name}`} className="self-start text-ink-soft hover:text-danger"><X className="size-4" /></button>
                  </li>
                );
              })}
            </ul>
            {applied ? (
              <p className="mt-2 flex items-center justify-between rounded-lg bg-ok-soft px-3 py-2 text-sm text-ok"><span><Tag className="mr-1 inline size-4" />{applied} applied</span><button className="font-semibold" onClick={() => setApplied('')}>Remove</button></p>
            ) : (
              <form className="mt-2 flex gap-2" onSubmit={(e) => { e.preventDefault(); if (coupon.trim()) setApplied(coupon.trim().toUpperCase()); }}>
                <input className="input" placeholder="Coupon code" aria-label="Coupon code" value={coupon} onChange={(e) => setCoupon(e.target.value)} />
                <button className="btn-outline shrink-0">Apply</button>
              </form>
            )}
            <ErrorNote>{qErr}</ErrorNote>
            {s && (
              <dl className="mt-4 space-y-1.5 text-sm">
                <div className="flex justify-between"><dt className="text-ink-soft">Items</dt><dd>{inr(s.subtotal)}</dd></div>
                {s.discountTotal > 0 && <div className="flex justify-between text-ok"><dt>Coupon</dt><dd>−{inr(s.discountTotal)}</dd></div>}
                <div className="flex justify-between"><dt className="text-ink-soft">Includes GST</dt><dd>{inr(s.gstTotal)}</dd></div>
                <div className="flex justify-between"><dt className="text-ink-soft">Delivery</dt><dd>{s.deliveryCharge ? inr(s.deliveryCharge) : selected ? 'Free' : 'Choose address'}</dd></div>
                {s.jarDeposit > 0 && <div className="flex justify-between"><dt className="text-[#9a6a12]">Jar deposit (refundable)</dt><dd className="text-[#9a6a12]">{inr(s.jarDeposit)}</dd></div>}
                <div className="flex justify-between border-t border-shoal pt-2 text-base"><dt className="font-semibold">Total</dt><dd className="font-display text-2xl font-bold text-depth">{inr(s.grandTotal)}</dd></div>
                {s.mrpSavings > 0 && <p className="text-right text-[13px] font-semibold text-ok">You save {inr(s.mrpSavings)} on MRP</p>}
              </dl>
            )}
            <Button className="mt-4 w-full py-3" busy={placing} disabled={!quote || !addressId || !method || !!qErr || !selected?.zone_id} onClick={place}>
              {['razorpay', 'upi'].includes(method) ? `Pay ${s ? inr(s.grandTotal) : ''}` : 'Place order'}
            </Button>
          </div>
        </aside>
      </div>
      <Modal open={adding} onClose={() => setAdding(false)} title="New delivery address" wide>
        <AddressForm onCancel={() => setAdding(false)} onSaved={(a) => { setAdding(false); addresses.reload(); setAddressId(a.id); if (!a.serviceable) toast('We do not deliver to this pincode yet', 'danger'); }} />
      </Modal>
    </div>
  );
}
