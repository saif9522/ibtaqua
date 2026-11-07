import { useEffect, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Star, ShieldCheck, Repeat, Truck } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { useAuth, useSite } from '../../hooks/useSite';
import { cartActions, toast } from '../../redux/store';
import { Loading, ErrorNote, QtyStepper } from '../../components/ui';
import ProductCard, { PriceLine } from '../../features/ProductCard';
import { inr, imgUrl, size, date } from '../../utils/format';

export default function ProductDetail() {
  const { slug } = useParams();
  const { data: p, loading, error } = useApi(`/products/${slug}`);
  const { user, isBuyer } = useAuth();
  const site = useSite();
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const [qty, setQty] = useState(1);
  const [img, setImg] = useState(null);
  useEffect(() => { if (p) { setQty(p.price?.minOrderQty || 1); setImg(p.images?.[0] || p.image); } }, [p]);

  if (loading) return <Loading />;
  if (error) return <div className="mx-auto max-w-3xl p-8"><ErrorNote>{error}</ErrorNote></div>;
  if (!p) return null;
  const moq = p.price?.minOrderQty || 1;
  const nextBreak = p.price?.quantityBreaks?.find((b) => qty < b.minQty);
  const add = (go) => { dispatch(cartActions.add({ product: p, quantity: qty })); if (go) { dispatch(cartActions.toggle(false)); navigate('/checkout'); } else toast(`${qty} × ${p.name} added`); };
  const gallery = [...new Set([p.image, ...(p.images || [])].filter(Boolean))];

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <nav className="mb-5 text-sm text-ink-soft" aria-label="Breadcrumb"><Link to="/shop" className="hover:text-aqua-700">Shop</Link> / <Link to={`/shop/${p.category_slug}`} className="hover:text-aqua-700">{p.category_name}</Link></nav>
      <div className="grid gap-10 lg:grid-cols-2">
        <div>
          <img src={imgUrl(img)} alt={p.name} className={`aspect-square w-full rounded-[var(--radius-panel)] bg-mist ${String(img).endsWith('.svg') ? 'object-cover' : 'object-contain p-8 mix-blend-multiply'}`} />
          {gallery.length > 1 && (
            <div className="mt-3 flex gap-2">{gallery.map((g) => <button key={g} onClick={() => setImg(g)} className={`size-16 overflow-hidden rounded-lg border-2 ${img === g ? 'border-aqua' : 'border-transparent'}`}><img src={g} alt="" className="size-full object-cover" /></button>)}</div>
          )}
        </div>
        <div>
          <h1 className="text-3xl sm:text-4xl">{p.name}</h1>
          {p.rating && <p className="mt-2 flex items-center gap-1 text-sm text-ink-soft"><Star className="size-4 fill-marigold text-marigold" />{p.rating.avg} from {p.rating.count} reviews</p>}
          <div className="mt-4"><PriceLine product={p} large /></div>
          <p className="mt-1 text-[13px] text-ink-soft">Inclusive of {Number(p.gst_percent)}% GST · SKU {p.sku}</p>

          {p.price?.quantityBreaks?.length > 0 && (
            <div className="mt-4 rounded-[var(--radius-ctl)] bg-mist px-4 py-3 text-sm">
              <p className="font-semibold text-depth">Buy more, pay less</p>
              <ul className="mt-1 text-ink-soft">{p.price.quantityBreaks.map((b) => <li key={b.minQty}>{b.minQty}+ units: {b.discountPercent}% off</li>)}</ul>
              {nextBreak && <p className="mt-1 font-semibold text-aqua-700">Add {nextBreak.minQty - qty} more to save {nextBreak.discountPercent}%</p>}
            </div>
          )}

          {p.price ? (
            <div className="mt-6">
              <div className="flex flex-wrap items-center gap-3">
                <QtyStepper value={qty} min={moq} onChange={setQty} />
                <button className="btn-primary px-6 py-3" disabled={!p.inStock || (user && !isBuyer)} onClick={() => add(false)}>Add to cart</button>
                <button className="btn-dark px-6 py-3" disabled={!p.inStock || (user && !isBuyer)} onClick={() => add(true)}>Buy now</button>
              </div>
              {moq > 1 && <p className="mt-2 text-sm text-ink-soft">Minimum order for your account: {moq}</p>}
              {p.stockLeft && <p className="mt-2 text-sm font-semibold text-[#9a6a12]">Only {p.stockLeft} left in stock</p>}
              {!p.inStock && <p className="mt-2 text-sm font-semibold text-danger">Out of stock. Check back after the next production batch.</p>}
            </div>
          ) : (
            <div className="mt-6 rounded-[var(--radius-ctl)] border border-shoal p-4 text-sm">This product is sold to approved business partners. <Link to="/partners" className="link">Register as a partner</Link> or <Link to="/bulk-orders" className="link">ask for a quote</Link>.</div>
          )}

          <ul className="mt-8 space-y-3 text-sm">
            <li className="flex gap-3"><ShieldCheck className="size-5 shrink-0 text-aqua" /><span>{p.packaging_info}. Size: {size(p.size_ml)}{p.units_per_pack > 1 ? `, ${p.units_per_pack} per pack` : ''}.</span></li>
            {!!p.is_returnable_jar && <li className="flex gap-3"><Repeat className="size-5 shrink-0 text-marigold" /><span>Returnable jar. Hand over an empty jar at each delivery. New jars carry a refundable deposit{site.jar_deposit_amount ? ` of ${inr(site.jar_deposit_amount)} each` : ''}.</span></li>}
            <li className="flex gap-3"><Truck className="size-5 shrink-0 text-aqua" /><span>Choose a delivery slot at checkout. Want it regularly? {user ? <Link to="/account/subscriptions" className="link">Set up a subscription</Link> : 'Log in to set up a subscription'}.</span></li>
          </ul>
          {p.description && <div className="mt-6 border-t border-shoal pt-6"><h2 className="text-xl">About this product</h2><p className="mt-2 whitespace-pre-line text-ink-soft">{p.description}</p></div>}
        </div>
      </div>

      <section className="mt-14">
        <h2 className="text-2xl">Reviews</h2>
        {!p.reviews.length && <p className="mt-2 text-ink-soft">No reviews yet. Bought this? Review it from My orders after delivery.</p>}
        <div className="mt-4 grid gap-4 md:grid-cols-2">
          {p.reviews.map((r) => (
            <div key={r.id} className="rounded-[var(--radius-panel)] bg-mist p-5">
              <div className="flex gap-0.5">{Array.from({ length: r.rating }).map((_, i) => <Star key={i} className="size-4 fill-marigold text-marigold" />)}</div>
              {r.comment && <p className="mt-2">{r.comment}</p>}
              <p className="mt-2 text-sm text-ink-soft">{r.name} · {date(r.created_at)}</p>
            </div>
          ))}
        </div>
      </section>
      {!!p.related?.length && (
        <section className="mt-14"><h2 className="text-2xl">You may also need</h2><div className="mt-5 grid grid-cols-2 gap-4 md:grid-cols-4">{p.related.map((r) => <ProductCard key={r.id} product={r} />)}</div></section>
      )}
    </div>
  );
}
