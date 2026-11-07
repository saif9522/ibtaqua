import { useState } from 'react';
import { Link, useParams, useSearchParams } from 'react-router-dom';
import { Search } from 'lucide-react';
import { useApi, useDebounced } from '../../hooks/useApi';
import { useAuth } from '../../hooks/useSite';
import ProductCard from '../../features/ProductCard';
import { Loading, ErrorNote, Empty, Pagination } from '../../components/ui';
import { TIER_LABEL } from '../../utils/format';

export default function Shop() {
  const { category } = useParams();
  const [sp, setSp] = useSearchParams();
  const [q, setQ] = useState(sp.get('search') || '');
  const search = useDebounced(q);
  const sort = sp.get('sort') || 'size';
  const page = Number(sp.get('page') || 1);
  const { user } = useAuth();
  const cats = useApi('/categories');
  const qs = new URLSearchParams({ page, limit: 24, sort, ...(category && { category }), ...(search && { search }) });
  const { data, loading, error, reload } = useApi(`/products?${qs}`);
  const current = cats.data?.find((c) => c.slug === category);

  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <h1 className="text-4xl">{current?.name || 'All water'}</h1>
      <p className="mt-1 max-w-2xl text-ink-soft">{current?.description || 'Bottles, cases, 20 litre jar refills and bulk supply from our Palamu plant.'}</p>
      {data?.tier && data.tier !== 'customer' && <p className="mt-3 inline-block rounded-full bg-[#dff3f8] px-3 py-1 text-sm font-semibold text-aqua-700">Showing your {TIER_LABEL[data.tier].toLowerCase()} prices</p>}

      <div className="mt-6 flex flex-col gap-3 lg:flex-row lg:items-center">
        <nav className="-mx-1 flex gap-1 overflow-x-auto pb-1" aria-label="Categories">
          <Link to="/shop" className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${!category ? 'bg-depth text-white' : 'bg-mist text-ink hover:bg-mist-2'}`}>All</Link>
          {(cats.data || []).map((c) => (
            <Link key={c.id} to={`/shop/${c.slug}`} className={`whitespace-nowrap rounded-full px-3.5 py-1.5 text-sm font-semibold ${category === c.slug ? 'bg-depth text-white' : 'bg-mist text-ink hover:bg-mist-2'}`}>{c.name.replace(' Packaged Drinking Water', '')}</Link>
          ))}
        </nav>
        <div className="flex gap-2 lg:ml-auto">
          <div className="relative flex-1 lg:w-64">
            <Search className="absolute left-3 top-3 size-4 text-ink-soft" />
            <input className="input pl-9" placeholder="Search water" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} />
          </div>
          <select className="input w-auto" aria-label="Sort" value={sort} onChange={(e) => { sp.set('sort', e.target.value); setSp(sp); }}>
            <option value="size">Size</option><option value="price">Price</option><option value="name">Name</option><option value="newest">Newest</option>
          </select>
        </div>
      </div>

      <div className="mt-8">
        {loading && <Loading label="Loading products" />}
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
        {data && !data.data.length && <Empty title="No products match">Try a different size or clear your search.</Empty>}
        <div className="grid grid-cols-2 gap-x-4 gap-y-10 md:grid-cols-3 lg:grid-cols-4">
          {data?.data.map((p) => <ProductCard key={p.id} product={p} />)}
        </div>
        {data && <Pagination page={data.page} limit={data.limit} total={data.total} onPage={(p) => { sp.set('page', p); setSp(sp); }} />}
      </div>
      {!user && <p className="mt-10 text-center text-sm text-ink-soft">Run a shop or distribute water? <Link to="/partners" className="link">Register as a partner</Link> to see your prices.</p>}
    </div>
  );
}
