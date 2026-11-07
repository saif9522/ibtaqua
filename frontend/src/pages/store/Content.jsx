import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { ChevronDown, Phone, Mail, MapPin, MessageCircle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useSite } from '../../hooks/useSite';
import { api, errMsg } from '../../services/api';
import Markdown from '../../features/Markdown';
import BulkEnquiryForm from '../../features/BulkEnquiryForm';
import { Loading, ErrorNote, StatusBadge, Input, Button } from '../../components/ui';
import { dateTime, humanize, inr, ORDER_STEPS } from '../../utils/format';

export function CmsPage({ slug: fixed }) {
  const { slug: param } = useParams();
  const slug = fixed || param;
  const { data, loading, error } = useApi(`/cms/page/${slug}`);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      {loading && <Loading />}
      <ErrorNote>{error}</ErrorNote>
      {data && <Markdown source={data.body?.markdown || ''} />}
    </div>
  );
}

export function Faq() {
  const { data, loading } = useApi('/cms?type=faq');
  const [open, setOpen] = useState(0);
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-4xl">Questions people ask</h1>
      {loading && <Loading />}
      <div className="mt-8 divide-y divide-shoal border-y border-shoal">
        {(data || []).map((f, i) => (
          <div key={f.id}>
            <button className="flex w-full items-center justify-between gap-4 py-4 text-left font-semibold text-depth" aria-expanded={open === i} onClick={() => setOpen(open === i ? -1 : i)}>
              {f.title}<ChevronDown className={`size-5 shrink-0 transition-transform ${open === i ? 'rotate-180' : ''}`} />
            </button>
            {open === i && <p className="pb-5 text-ink-soft">{f.body?.answer}</p>}
          </div>
        ))}
      </div>
    </div>
  );
}

export function Contact() {
  const biz = useSite().business_profile || {};
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-2">
      <div>
        <h1 className="text-4xl">Talk to us</h1>
        <p className="mt-3 text-ink-soft">Questions about an order, a delivery or partnering with us. We reply on working days.</p>
        <ul className="mt-8 space-y-4">
          {biz.phone && <li className="flex gap-3"><Phone className="size-5 text-aqua" /><a className="link" href={`tel:+91${biz.phone}`}>+91 {biz.phone}</a></li>}
          {biz.whatsapp && <li className="flex gap-3"><MessageCircle className="size-5 text-aqua" /><a className="link" href={`https://wa.me/91${biz.whatsapp}`} target="_blank" rel="noreferrer">WhatsApp +91 {biz.whatsapp}</a></li>}
          {biz.email && <li className="flex gap-3"><Mail className="size-5 text-aqua" /><a className="link" href={`mailto:${biz.email}`}>{biz.email}</a></li>}
          <li className="flex gap-3"><MapPin className="size-5 text-aqua" /><span>{[biz.legal_name, biz.address, biz.city, biz.state, biz.pincode].filter(Boolean).join(', ')}</span></li>
        </ul>
      </div>
      <div className="panel p-6 sm:p-8"><h2 className="mb-4 text-2xl">Send a message</h2><BulkEnquiryForm type="contact" /></div>
    </div>
  );
}

export function BulkOrders() {
  return (
    <div className="mx-auto grid max-w-6xl gap-10 px-4 py-12 lg:grid-cols-2">
      <div>
        <h1 className="text-4xl sm:text-5xl">Water for events, sites and institutions</h1>
        <p className="mt-4 text-lg text-ink-soft">From 100 cases of 500 ml bottles for a wedding to daily 20L jars for a school, or tanker supply for a construction site.</p>
        <dl className="mt-8 grid grid-cols-2 gap-6">
          {[['Events and weddings', '500 ml and 1 L cases, delivered the day before'], ['Offices and schools', 'Daily or weekly 20L jars with a dispenser plan'], ['Hotels and restaurants', 'Bottles with your order on a fixed schedule'], ['Construction and industry', 'Bulk supply in 1,000 litre loads']].map(([t, d]) => (
            <div key={t}><dt className="font-display text-lg font-bold text-depth">{t}</dt><dd className="mt-1 text-sm text-ink-soft">{d}</dd></div>
          ))}
        </dl>
      </div>
      <div className="panel p-6 sm:p-8"><h2 className="mb-4 text-2xl">Get a quote</h2><BulkEnquiryForm type="bulk" /></div>
    </div>
  );
}

export function TrackOrder() {
  const [f, setF] = useState({ order: '', phone: '' });
  const [res, setRes] = useState(null);
  const [err, setErr] = useState(null);
  const [busy, setBusy] = useState(false);
  const submit = async (e) => {
    e.preventDefault(); setErr(null); setBusy(true);
    try { setRes((await api.get(`/track/${encodeURIComponent(f.order.trim().toUpperCase())}`, { params: { phone: f.phone } })).data); } catch (er) { setRes(null); setErr(errMsg(er)); } finally { setBusy(false); }
  };
  const idx = res ? ORDER_STEPS.indexOf(res.status) : -1;
  return (
    <div className="mx-auto max-w-3xl px-4 py-12">
      <h1 className="text-4xl">Track your order</h1>
      <form onSubmit={submit} className="mt-6 grid gap-3 sm:grid-cols-[1fr_1fr_auto] sm:items-end">
        <Input label="Order number" placeholder="IBT26110712345" value={f.order} onChange={(e) => setF({ ...f, order: e.target.value })} required />
        <Input label="Mobile used for the order" inputMode="numeric" maxLength={10} value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value.replace(/\D/g, '') })} required />
        <Button busy={busy}>Track</Button>
      </form>
      <div className="mt-4"><ErrorNote>{err}</ErrorNote></div>
      {res && (
        <div className="panel mt-6 p-6">
          <div className="flex flex-wrap items-center justify-between gap-2"><p className="font-display text-xl font-bold text-depth">{res.order_number}</p><StatusBadge status={res.status} /></div>
          <p className="mt-1 text-sm text-ink-soft">Total {inr(res.grand_total)} · Payment {humanize(res.payment_status)}{res.delivery_date ? ` · Delivery ${res.delivery_date} ${res.delivery_slot || ''}` : ''}</p>
          {idx >= 0 && (
            <div className="mt-5 flex gap-1" aria-label="Progress">{ORDER_STEPS.map((s, i) => <div key={s} title={humanize(s)} className={`h-2 flex-1 rounded-full ${i <= idx ? 'bg-aqua' : 'bg-shoal'}`} />)}</div>
          )}
          <ol className="mt-5 space-y-3">{res.timeline.slice().reverse().map((t, i) => <li key={i} className="flex justify-between gap-4 text-sm"><span><b className="text-depth">{humanize(t.to_status)}</b>{t.note ? ` · ${t.note}` : ''}</span><span className="shrink-0 text-ink-soft">{dateTime(t.created_at)}</span></li>)}</ol>
        </div>
      )}
    </div>
  );
}
