import { Link } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Star } from 'lucide-react';
import { cartActions, toast } from '../redux/store';
import { inr, imgUrl, TIER_LABEL } from '../utils/format';

export function PriceLine({ product, large }) {
  const p = product.price;
  if (!p) return <p className="text-sm text-ink-soft">Available for business partners</p>;
  const off = product.mrp > p.unitPrice ? Math.round(((product.mrp - p.unitPrice) / product.mrp) * 100) : 0;
  return (
    <div className="flex flex-wrap items-baseline gap-x-2">
      <span className={`font-display font-bold text-depth ${large ? 'text-3xl' : 'text-xl'}`}>{inr(p.unitPrice)}</span>
      {off > 0 && <span className="text-sm text-ink-soft line-through">{inr(product.mrp)}</span>}
      {off > 0 && <span className="text-[13px] font-semibold text-ok">{off}% off MRP</span>}
      {p.tier !== 'customer' && <span className="w-full text-[12.5px] font-semibold text-aqua-700">{TIER_LABEL[p.tier]} price{p.source === 'negotiated' ? ' (your agreement)' : ''}</span>}
    </div>
  );
}

export default function ProductCard({ product }) {
  const dispatch = useDispatch();
  const moq = product.price?.minOrderQty || 1;
  const add = () => {
    dispatch(cartActions.add({ product, quantity: moq }));
    toast(`${product.name} added to cart`);
  };
  return (
    <article className="group flex flex-col">
      <Link to={`/product/${product.slug}`} className="relative block overflow-hidden rounded-[var(--radius-panel)] bg-mist">
        <img src={imgUrl(product.image)} alt={product.name} loading="lazy" className={`aspect-square w-full transition-transform duration-500 group-hover:scale-[1.03] ${String(product.image).endsWith('.svg') ? 'object-cover' : 'object-contain p-4 mix-blend-multiply'}`} />
        {!!product.is_returnable_jar && <span className="absolute left-3 top-3 rounded-full bg-white/90 px-2.5 py-1 text-[12px] font-semibold text-depth">Returnable jar</span>}
        {!product.inStock && <span className="absolute inset-x-0 bottom-0 bg-depth/80 py-1.5 text-center text-[13px] font-semibold text-white">Out of stock</span>}
      </Link>
      <div className="flex flex-1 flex-col pt-3">
        <Link to={`/product/${product.slug}`} className="font-semibold leading-snug text-ink hover:text-aqua-700">{product.name}</Link>
        {product.rating && <p className="mt-0.5 flex items-center gap-1 text-[13px] text-ink-soft"><Star className="size-3.5 fill-marigold text-marigold" />{product.rating.avg} ({product.rating.count})</p>}
        <div className="mt-1.5 flex-1"><PriceLine product={product} /></div>
        {moq > 1 && <p className="mt-1 text-[12.5px] text-ink-soft">Minimum order {moq}</p>}
        <button className="btn-outline mt-3 w-full" onClick={add} disabled={!product.price || !product.inStock}>
          {product.inStock ? (moq > 1 ? `Add ${moq} to cart` : 'Add to cart') : 'Out of stock'}
        </button>
      </div>
    </article>
  );
}
