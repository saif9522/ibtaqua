import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Star, Truck, CheckCircle2 } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useSite, useAuth } from '../../hooks/useSite';
import { api, errMsg } from '../../services/api';
import ProductCard from '../../features/ProductCard';
import { WaveEdge } from '../../components/Brand';
import { inr } from '../../utils/format';
import BulkEnquiryForm from '../../features/BulkEnquiryForm';
import HeroSlider from '../../features/HeroSlider';

function PincodeCheck() {
  const [pin, setPin] = useState('');
  const [res, setRes] = useState(null);
  const check = async (e) => {
    e.preventDefault();
    if (!/^\d{6}$/.test(pin)) return setRes({ error: 'Enter a 6-digit pincode' });
    try { setRes((await api.get(`/delivery/check/${pin}`)).data); } catch (er) { setRes({ error: errMsg(er) }); }
  };
  return (
    <form onSubmit={check} className="w-full max-w-md">
      <label htmlFor="pin" className="mb-1.5 block text-sm font-semibold text-depth">Do we deliver to you?</label>
      <div className="flex gap-2">
        <input id="pin" className="input" inputMode="numeric" maxLength={6} placeholder="Your pincode" value={pin} onChange={(e) => { setPin(e.target.value.replace(/\D/g, '')); setRes(null); }} />
        <button className="btn-dark shrink-0">Check</button>
      </div>
      {res && (
        <p className={`mt-2 text-sm ${res.serviceable ? 'text-ok' : 'text-ink-soft'}`} role="status">
          {res.error || (res.serviceable
            ? `Yes, we deliver to ${pin} (${res.zone.name}). ${res.zone.deliveryCharge ? `Delivery ${inr(res.zone.deliveryCharge)}${res.zone.freeDeliveryAbove ? `, free above ${inr(res.zone.freeDeliveryAbove)}` : ''}.` : 'Free delivery.'}`
            : `Not yet. Message us on WhatsApp and we'll tell you when ${pin} is added.`)}
        </p>
      )}
    </form>
  );
}

export default function Home() {
  const site = useSite();
  const { user } = useAuth();
  const featured = useApi('/products?featured=true&limit=8');
  const cats = useApi('/categories');
  const cms = useApi('/cms');
  const reviews = useApi('/testimonials');
  const zones = useApi('/delivery/zones');
  const section = (slug) => cms.data?.find((c) => c.slug === slug)?.body;
  const process = section('quality-process')?.steps || [];
  const why = section('why-choose')?.items || [];
  const banners = cms.data?.filter((c) => c.type === 'banner') || [];

  return (
    <>
      <HeroSlider slides={banners} />
      <div className="border-y border-shoal/70 bg-white">
        <div className="mx-auto flex max-w-7xl flex-col gap-3 px-4 py-5 sm:flex-row sm:items-end sm:justify-between">
          <PincodeCheck />
          <p className="text-sm text-ink-soft">{site.business_profile?.legal_name || 'IBT ENTERPRISES'} · {site.business_profile?.district || 'Palamu'}, Jharkhand</p>
        </div>
      </div>

      {/* Categories */}
      <section className="mx-auto max-w-7xl px-4 py-14">
        <h2 className="text-3xl">Shop by size</h2>
        <div className="mt-6 grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-7">
          {(cats.data || []).map((c) => (
            <Link key={c.id} to={`/shop/${c.slug}`} className="rounded-[var(--radius-panel)] border border-shoal p-4 transition-colors hover:border-aqua hover:bg-mist">
              <p className="font-display text-lg font-bold leading-tight text-depth">{c.name.replace(' Packaged Drinking Water', '')}</p>
              <p className="mt-1 text-[13px] text-ink-soft">{c.product_count} {c.product_count === 1 ? 'product' : 'products'}</p>
            </Link>
          ))}
        </div>
      </section>

      {/* Best sellers */}
      <section className="mx-auto max-w-7xl px-4 pb-14">
        <div className="flex items-end justify-between">
          <h2 className="text-3xl">Most ordered</h2>
          <Link to="/shop" className="link text-sm">See all products</Link>
        </div>
        <div className="mt-6 grid grid-cols-2 gap-x-4 gap-y-8 md:grid-cols-4">
          {(featured.data?.data || []).slice(0, 4).map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
      </section>

      {/* Quality process — a true sequence, so it is numbered. */}
      {!!process.length && (
        <section className="bg-mist">
          <WaveEdge fill="#ffffff" className="rotate-180" />
          <div className="mx-auto max-w-7xl px-4 py-14">
            <h2 className="max-w-xl text-3xl">{section('quality-process') && cms.data.find((c) => c.slug === 'quality-process').title}</h2>
            <p className="mt-2 max-w-xl text-ink-soft">Every bottle and jar passes through the same steps, and every batch is lab-tested before it leaves the plant.</p>
            <ol className="mt-10 grid gap-x-8 gap-y-8 sm:grid-cols-2 lg:grid-cols-3">
              {process.map((s, i) => (
                <li key={s.title} className="flex gap-4">
                  <span className="font-display text-4xl font-extrabold leading-none text-aqua/40">{i + 1}</span>
                  <div><h3 className="text-lg">{s.title}</h3><p className="mt-1 text-sm text-ink-soft">{s.text}</p></div>
                </li>
              ))}
            </ol>
          </div>
          <WaveEdge fill="#ffffff" />
        </section>
      )}

      {/* Why IBT AQUA */}
      {!!why.length && (
        <section className="mx-auto max-w-7xl px-4 py-14">
          <h2 className="text-3xl">Why families and shops choose us</h2>
          <div className="mt-8 grid gap-8 sm:grid-cols-2 lg:grid-cols-4">
            {why.map((w) => (
              <div key={w.title} className="border-l-2 border-aqua pl-4">
                <h3 className="text-lg">{w.title}</h3><p className="mt-1 text-sm text-ink-soft">{w.text}</p>
              </div>
            ))}
          </div>
        </section>
      )}

      {/* Partners */}
      <section className="mx-auto max-w-7xl px-4">
        <div className="grid overflow-hidden rounded-[28px] bg-depth text-white lg:grid-cols-2">
          <div className="p-8 sm:p-12">
            <h2 className="text-3xl text-white">Sell IBT AQUA in your shop or area</h2>
            <p className="mt-3 max-w-md text-[#cfe6ee]">Retailers, wholesalers and distributors get their own prices, minimum quantities that fit their business, monthly credit and scheduled supply.</p>
            <ul className="mt-6 space-y-2 text-[15px]">
              {['Partner prices shown automatically after approval', 'Order in cases, track deliveries, download GST invoices', 'Credit billing with a running statement'].map((t) => (
                <li key={t} className="flex gap-2"><CheckCircle2 className="mt-0.5 size-4 shrink-0 text-[#7fd6e8]" />{t}</li>
              ))}
            </ul>
            <div className="mt-8 flex flex-wrap gap-3">
              <Link to="/partners?type=retailer" className="btn bg-white text-depth hover:bg-mist">Register as retailer</Link>
              <Link to="/partners?type=wholesaler" className="btn border border-white/30 text-white hover:bg-white/10">Wholesaler or distributor</Link>
            </div>
          </div>
          <div className="bg-[#0d5a78] p-8 sm:p-12">
            <h3 className="text-2xl text-white">Need water in bulk?</h3>
            <p className="mt-2 text-[#cfe6ee]">Weddings, events, construction sites, schools and offices. Tell us what you need and we'll call you with a quote.</p>
            <div className="mt-5"><BulkEnquiryForm dark /></div>
          </div>
        </div>
      </section>

      {/* Reviews */}
      {!!reviews.data?.length && (
        <section className="mx-auto max-w-7xl px-4 py-14">
          <h2 className="text-3xl">What customers say</h2>
          <div className="mt-6 grid gap-6 md:grid-cols-3">
            {reviews.data.slice(0, 3).map((r, i) => (
              <figure key={i} className="rounded-[var(--radius-panel)] bg-mist p-6">
                <div className="flex gap-0.5" aria-label={`${r.rating} out of 5`}>{Array.from({ length: r.rating }).map((_, k) => <Star key={k} className="size-4 fill-marigold text-marigold" />)}</div>
                <blockquote className="mt-3 text-[16px] leading-relaxed text-ink">{r.comment}</blockquote>
                <figcaption className="mt-4 text-sm text-ink-soft"><span className="font-semibold text-depth">{r.name}</span> on {r.product}</figcaption>
              </figure>
            ))}
          </div>
        </section>
      )}

      {/* Coverage */}
      <section className="mx-auto max-w-7xl px-4 pb-4">
        <div className="flex flex-col gap-6 rounded-[var(--radius-panel)] border border-shoal p-6 sm:flex-row sm:items-center sm:p-8">
          <Truck className="size-10 shrink-0 text-aqua" strokeWidth={1.5} />
          <div className="flex-1">
            <h2 className="text-2xl">Where we deliver</h2>
            <p className="mt-1 text-ink-soft">{(zones.data || []).map((z) => `${z.name} (${z.pincodes.length} pincodes)`).join(', ') || 'Medininagar and nearby areas of Palamu.'}</p>
          </div>
          {!user && <Link to="/login" className="btn-primary shrink-0">Create an account</Link>}
        </div>
      </section>
    </>
  );
}
