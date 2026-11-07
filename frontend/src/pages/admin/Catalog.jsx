import { useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { Plus, Upload, Trash2, Star, Search } from 'lucide-react';
import { useApi, useAction, useDebounced } from '../../hooks/useApi';
import { api, errMsg, errFields } from '../../services/api';
import { toast } from '../../redux/store';
import { useAuth } from '../../hooks/useSite';
import { PageHeader, Loading, ErrorNote, DataTable, StatusBadge, Pagination, Button, Modal, Input, Select, Textarea, Checkbox, Badge } from '../../components/ui';
import { inr, imgUrl, size, toPaise, toRupees, TIER_LABEL, date } from '../../utils/format';

const TIERS = ['customer', 'retailer', 'wholesaler', 'distributor'];

export function Products() {
  const [page, setPage] = useState(1);
  const [q, setQ] = useState('');
  const search = useDebounced(q);
  const { data, loading, error, reload } = useApi(`/admin/products?page=${page}&limit=25${search ? `&search=${search}` : ''}`);
  const navigate = useNavigate();
  return (
    <>
      <PageHeader title="Products"><Link to="/admin/products/new" className="btn-primary"><Plus className="size-4" />Add product</Link></PageHeader>
      <div className="relative mb-4 max-w-sm"><Search className="absolute left-3 top-3 size-4 text-ink-soft" /><input className="input pl-9" placeholder="Search name or SKU" aria-label="Search products" value={q} onChange={(e) => setQ(e.target.value)} /></div>
      <div className="panel">
        {loading && !data && <Loading />}
        <ErrorNote onRetry={reload}>{error}</ErrorNote>
        {data && <DataTable rows={data.data} onRowClick={(r) => navigate(`/admin/products/${r.id}`)} columns={[
          { key: 'name', label: 'Product', render: (r) => <div className="flex items-center gap-3"><img src={imgUrl(r.image)} alt="" className="size-10 rounded bg-mist object-cover" /><div><p className="font-semibold">{r.name}</p><p className="text-[12px] text-ink-soft">{r.sku} · {r.category_name} · {size(r.size_ml)}</p></div></div> },
          { key: 'mrp', label: 'MRP', render: (r) => inr(r.mrp) },
          ...TIERS.map((t) => ({ key: t, label: TIER_LABEL[t], render: (r) => (r.prices[t] ? <span>{inr(r.prices[t].price)}{r.prices[t].minOrderQty > 1 && <span className="block text-[11.5px] text-ink-soft">min {r.prices[t].minOrderQty}</span>}</span> : <span className="text-ink-soft">Not sold</span>) })),
          { key: 'gst', label: 'GST', render: (r) => `${Number(r.gst_percent)}%` },
          { key: 'stock', label: 'Stock', render: (r) => <span className={r.quantity_available <= r.low_stock_threshold ? 'font-semibold text-danger' : ''}>{r.quantity_available}{r.quantity_reserved ? <span className="text-ink-soft"> (+{r.quantity_reserved} reserved)</span> : ''}</span> },
          { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
        ]} />}
        {data && <div className="px-3"><Pagination page={data.page} limit={data.limit} total={data.total} onPage={setPage} /></div>}
      </div>
    </>
  );
}

export function ProductEditor() {
  const { id } = useParams();
  const isNew = id === 'new';
  const navigate = useNavigate();
  const { can } = useAuth();
  const cats = useApi('/admin/categories');
  const { data: p, reload } = useApi(isNew ? null : `/admin/products/${id}`);
  const zones = useApi('/admin/zones');
  const [err, setErr] = useState(null);
  const [run, busy] = useAction();
  const { register, handleSubmit, reset, setError, formState: { errors, isSubmitting } } = useForm({ defaultValues: { unitType: 'bottle', unitsPerPack: 1, gstPercent: 18, status: 'active', hsnCode: '2201', lowStockThreshold: 50 } });

  useEffect(() => {
    if (!p) return;
    const base = (t) => p.prices.find((x) => x.tier === t && !x.user_id && !x.zone_id);
    reset({
      categoryId: p.category_id, name: p.name, sku: p.sku, description: p.description || '', sizeMl: p.size_ml, unitType: p.unit_type, unitsPerPack: p.units_per_pack,
      mrp: toRupees(p.mrp), gstPercent: Number(p.gst_percent), hsnCode: p.hsn_code || '', packagingInfo: p.packaging_info || '', isReturnableJar: !!p.is_returnable_jar, status: p.status, isFeatured: !!p.is_featured,
      lowStockThreshold: p.inventory?.low_stock_threshold ?? 50,
      ...Object.fromEntries(TIERS.flatMap((t) => [[`price_${t}`, base(t) ? toRupees(base(t).price) : ''], [`moq_${t}`, base(t)?.min_order_qty || 1], [`disc_${t}`, base(t) ? Number(base(t).discount_percent) : 0]])),
    });
  }, [p, reset]);

  const save = async (v) => {
    setErr(null);
    const prices = TIERS.filter((t) => v[`price_${t}`] !== '' && v[`price_${t}`] != null).map((t) => ({ tier: t, price: toPaise(v[`price_${t}`]), minOrderQty: Number(v[`moq_${t}`] || 1), discountPercent: Number(v[`disc_${t}`] || 0) }));
    const body = { categoryId: Number(v.categoryId), name: v.name, sku: v.sku, description: v.description, sizeMl: Number(v.sizeMl), unitType: v.unitType, unitsPerPack: Number(v.unitsPerPack), mrp: toPaise(v.mrp), gstPercent: Number(v.gstPercent), hsnCode: v.hsnCode, packagingInfo: v.packagingInfo, isReturnableJar: v.isReturnableJar, status: v.status, isFeatured: v.isFeatured, lowStockThreshold: Number(v.lowStockThreshold), ...(can('pricing.write') && { prices }) };
    try {
      const r = isNew ? await api.post('/admin/products', body) : await api.put(`/admin/products/${id}`, body);
      toast('Product saved');
      if (isNew) navigate(`/admin/products/${r.data.id}`, { replace: true }); else reload();
    } catch (e) { Object.entries(errFields(e)).forEach(([k, m]) => setError(k, { message: m })); setErr(errMsg(e)); }
  };
  if (!isNew && !p) return <Loading />;

  return (
    <>
      <PageHeader title={isNew ? 'New product' : p.name} back="/admin/products">{!isNew && <a className="btn-outline btn-sm" href={`/product/${p.slug}`} target="_blank" rel="noreferrer">View in store</a>}</PageHeader>
      <form onSubmit={handleSubmit(save)} className="grid gap-5 lg:grid-cols-[1.4fr_1fr]" noValidate>
        <div className="space-y-5">
          <section className="panel grid gap-4 p-5 sm:grid-cols-2">
            <Input className="sm:col-span-2" label="Product name" error={errors.name?.message} {...register('name', { required: 'Required' })} />
            <Input label="SKU" error={errors.sku?.message} {...register('sku', { required: 'Required' })} />
            <Select label="Category" placeholder="Choose" error={errors.categoryId?.message} options={(cats.data || []).map((c) => ({ value: c.id, label: c.name }))} {...register('categoryId', { required: 'Choose a category' })} />
            <Input label="Size (ml)" type="number" hint="e.g. 500, 1000, 20000" error={errors.sizeMl?.message} {...register('sizeMl', { required: 'Required' })} />
            <Select label="Sold as" options={[{ value: 'bottle', label: 'Single bottle' }, { value: 'case', label: 'Case / pack' }, { value: 'jar', label: 'Jar' }, { value: 'bulk', label: 'Bulk supply' }]} {...register('unitType')} />
            <Input label="Units per pack" type="number" min={1} {...register('unitsPerPack')} />
            <Input label="MRP (₹)" type="number" step="0.01" error={errors.mrp?.message} {...register('mrp', { required: 'Required' })} />
            <Input label="GST %" type="number" step="0.01" hint="Confirm the current rate for HSN 2201 with your CA" {...register('gstPercent', { required: true })} />
            <Input label="HSN code" {...register('hsnCode')} />
            <Input label="Low-stock alert at" type="number" {...register('lowStockThreshold')} />
            <Input className="sm:col-span-2" label="Packaging information" {...register('packagingInfo')} />
            <Textarea className="sm:col-span-2" label="Description" {...register('description')} />
            <div className="flex flex-wrap gap-5 sm:col-span-2">
              <Checkbox label="Returnable 20L-style jar (deposit and jar tracking)" {...register('isReturnableJar')} />
              <Checkbox label="Feature on home page" {...register('isFeatured')} />
            </div>
            <Select label="Status" options={['active', 'inactive', 'out_of_stock']} {...register('status')} />
          </section>

          <section className="panel p-5">
            <h2 className="text-lg">Prices by buyer type</h2>
            <p className="mt-1 text-sm text-ink-soft">Leave a price empty to hide the product from that buyer type. Buyers only ever see their own price.{!can('pricing.write') && ' You need pricing permission to change these.'}</p>
            <div className="mt-3 overflow-x-auto">
              <table className="table-base"><thead><tr><th>Buyer</th><th>Price (₹, incl. GST)</th><th>Minimum qty</th><th>Product discount %</th></tr></thead>
                <tbody>{TIERS.map((t) => (
                  <tr key={t}>
                    <td className="font-semibold">{TIER_LABEL[t]}</td>
                    <td><input className="input py-1.5" type="number" step="0.01" min="0" aria-label={`${t} price`} disabled={!can('pricing.write')} {...register(`price_${t}`)} /></td>
                    <td><input className="input py-1.5" type="number" min="1" aria-label={`${t} minimum`} disabled={!can('pricing.write')} {...register(`moq_${t}`)} /></td>
                    <td><input className="input py-1.5" type="number" step="0.01" min="0" max="100" aria-label={`${t} discount`} disabled={!can('pricing.write')} {...register(`disc_${t}`)} /></td>
                  </tr>
                ))}</tbody>
              </table>
            </div>
          </section>
          <ErrorNote>{err}</ErrorNote>
          <Button busy={isSubmitting} className="px-8">Save product</Button>
        </div>
        {!isNew && (
          <div className="space-y-5">
            <Images product={p} onChange={reload} />
            {can('pricing.write') && <QuantityBreaks product={p} onChange={reload} />}
            {can('pricing.write') && <Overrides product={p} zones={zones.data || []} onChange={reload} run={run} busy={busy} />}
          </div>
        )}
      </form>
    </>
  );
}

function Images({ product, onChange }) {
  const ref = useRef();
  const [run, busy] = useAction();
  const upload = () => run(async () => {
    const fd = new FormData(); [...ref.current.files].forEach((f) => fd.append('images', f));
    try { await api.post(`/admin/products/${product.id}/images`, fd); toast('Images uploaded'); ref.current.value = ''; onChange(); } catch (e) { toast(errMsg(e), 'danger'); }
  });
  return (
    <section className="panel p-5">
      <h2 className="text-lg">Images</h2>
      <div className="mt-3 grid grid-cols-3 gap-2">
        {product.image && !product.images.length && <img src={imgUrl(product.image)} alt="" className="aspect-square rounded-lg bg-mist object-cover" />}
        {product.images.map((im) => (
          <div key={im.id} className="group relative">
            <img src={im.path} alt="" className={`aspect-square w-full rounded-lg bg-mist object-cover ${product.image === im.path ? 'ring-2 ring-aqua' : ''}`} />
            <div className="absolute inset-x-1 bottom-1 flex justify-between opacity-0 group-hover:opacity-100 focus-within:opacity-100">
              <button type="button" className="rounded bg-white/90 p-1" title="Make main image" onClick={() => api.post(`/admin/products/${product.id}/images/${im.id}/primary`).then(onChange)}><Star className="size-4" /></button>
              <button type="button" className="rounded bg-white/90 p-1 text-danger" title="Delete" onClick={() => api.delete(`/admin/products/${product.id}/images/${im.id}`).then(onChange)}><Trash2 className="size-4" /></button>
            </div>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2"><input ref={ref} type="file" multiple accept="image/jpeg,image/png,image/webp" className="input py-2 text-sm" aria-label="Choose images" /><Button type="button" variant="outline" busy={busy} onClick={upload}><Upload className="size-4" /></Button></div>
    </section>
  );
}

function QuantityBreaks({ product, onChange }) {
  const [rows, setRows] = useState(product.quantityDiscounts.map((q) => ({ tier: q.tier, minQty: q.min_qty, discountPercent: Number(q.discount_percent) })));
  const [run, busy] = useAction();
  const save = () => run(async () => { try { await api.put(`/admin/products/${product.id}/quantity-discounts`, { breaks: rows.map((r) => ({ ...r, minQty: Number(r.minQty), discountPercent: Number(r.discountPercent) })) }); toast('Quantity discounts saved'); onChange(); } catch (e) { toast(errMsg(e), 'danger'); } });
  return (
    <section className="panel p-5">
      <h2 className="text-lg">Quantity discounts</h2>
      <p className="text-sm text-ink-soft">Extra % off when a buyer orders at least this many.</p>
      <div className="mt-3 space-y-2">
        {rows.map((r, i) => (
          <div key={i} className="flex gap-2">
            <select className="input py-1.5" aria-label="Buyer type" value={r.tier} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, tier: e.target.value } : x)))}>{TIERS.map((t) => <option key={t} value={t}>{TIER_LABEL[t]}</option>)}</select>
            <input className="input w-24 py-1.5" type="number" min={2} aria-label="Minimum quantity" placeholder="Qty" value={r.minQty} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, minQty: e.target.value } : x)))} />
            <input className="input w-20 py-1.5" type="number" step="0.5" aria-label="Discount percent" placeholder="%" value={r.discountPercent} onChange={(e) => setRows(rows.map((x, k) => (k === i ? { ...x, discountPercent: e.target.value } : x)))} />
            <button type="button" className="text-ink-soft hover:text-danger" aria-label="Remove" onClick={() => setRows(rows.filter((_, k) => k !== i))}><Trash2 className="size-4" /></button>
          </div>
        ))}
      </div>
      <div className="mt-3 flex gap-2"><button type="button" className="btn-ghost btn-sm" onClick={() => setRows([...rows, { tier: 'customer', minQty: 5, discountPercent: 2 }])}>Add rule</button><Button type="button" size="sm" busy={busy} onClick={save}>Save discounts</Button></div>
    </section>
  );
}

function Overrides({ product, zones, onChange }) {
  const overrides = product.prices.filter((x) => x.user_id || x.zone_id);
  const [open, setOpen] = useState(false);
  const [f, setF] = useState({ kind: 'zone', tier: 'customer', zoneId: '', phone: '', price: '', minOrderQty: 1, validTo: '' });
  const [run, busy] = useAction();
  const add = () => run(async () => {
    try {
      let userId = null;
      if (f.kind === 'user') {
        const r = await api.get(`/admin/users?role=${f.tier}&search=${f.phone}`);
        if (!r.data.data[0]) throw new Error(`No ${f.tier} found with that phone`);
        userId = r.data.data[0].id;
      }
      await api.post('/admin/prices', { productId: product.id, tier: f.tier, price: toPaise(f.price), minOrderQty: Number(f.minOrderQty), zoneId: f.kind === 'zone' ? Number(f.zoneId) : null, userId, validTo: f.validTo || undefined, discountPercent: 0, isActive: true });
      toast('Price added'); setOpen(false); onChange();
    } catch (e) { toast(e.response ? errMsg(e) : e.message, 'danger'); }
  });
  return (
    <section className="panel p-5">
      <div className="flex items-center justify-between"><h2 className="text-lg">Area and agreed prices</h2><button type="button" className="btn-outline btn-sm" onClick={() => setOpen(true)}>Add</button></div>
      <p className="text-sm text-ink-soft">Agreed prices for one buyer beat area prices, which beat the base price.</p>
      <ul className="mt-3 space-y-2 text-sm">
        {!overrides.length && <li className="text-ink-soft">None yet.</li>}
        {overrides.map((o) => (
          <li key={o.id} className="flex items-center justify-between gap-2 rounded bg-mist px-3 py-2">
            <span>{o.user_name ? <><Badge tone="aqua">Agreed</Badge> {o.user_name}</> : <><Badge>Area</Badge> {o.zone_name}</>} · {TIER_LABEL[o.tier]}<br /><span className="text-ink-soft">min {o.min_order_qty}{o.valid_to ? ` · until ${date(o.valid_to)}` : ''}</span></span>
            <span className="flex items-center gap-2 font-semibold">{inr(o.price)}<button type="button" className="text-ink-soft hover:text-danger" aria-label="Delete" onClick={() => window.confirm('Remove this price?') && api.delete(`/admin/prices/${o.id}`).then(onChange)}><Trash2 className="size-4" /></button></span>
          </li>
        ))}
      </ul>
      <Modal open={open} onClose={() => setOpen(false)} title="Add a special price" footer={<Button type="button" busy={busy} onClick={add}>Add price</Button>}>
        <div className="grid gap-3 sm:grid-cols-2">
          <Select label="Applies to" value={f.kind} onChange={(e) => setF({ ...f, kind: e.target.value })} options={[{ value: 'zone', label: 'A delivery area' }, { value: 'user', label: 'One buyer (agreement)' }]} />
          <Select label="Buyer type" value={f.tier} onChange={(e) => setF({ ...f, tier: e.target.value })} options={TIERS.map((t) => ({ value: t, label: TIER_LABEL[t] }))} />
          {f.kind === 'zone' ? <Select className="sm:col-span-2" label="Area" placeholder="Choose" value={f.zoneId} onChange={(e) => setF({ ...f, zoneId: e.target.value })} options={zones.map((z) => ({ value: z.id, label: z.name }))} />
            : <Input className="sm:col-span-2" label="Buyer's mobile number" value={f.phone} onChange={(e) => setF({ ...f, phone: e.target.value })} />}
          <Input label="Price (₹)" type="number" step="0.01" value={f.price} onChange={(e) => setF({ ...f, price: e.target.value })} />
          <Input label="Minimum qty" type="number" min={1} value={f.minOrderQty} onChange={(e) => setF({ ...f, minOrderQty: e.target.value })} />
          <Input label="Valid until (optional)" type="date" value={f.validTo} onChange={(e) => setF({ ...f, validTo: e.target.value })} />
        </div>
      </Modal>
    </section>
  );
}

export function Categories() {
  const { data, reload } = useApi('/admin/categories');
  const [edit, setEdit] = useState(null);
  const [run, busy] = useAction();
  const save = () => run(async () => {
    try {
      const body = { name: edit.name, description: edit.description, sortOrder: Number(edit.sort_order || 0), isActive: !!edit.is_active };
      if (edit.id) await api.put(`/admin/categories/${edit.id}`, body); else await api.post('/admin/categories', body);
      toast('Category saved'); setEdit(null); reload();
    } catch (e) { toast(errMsg(e), 'danger'); }
  });
  return (
    <>
      <PageHeader title="Categories"><button className="btn-primary" onClick={() => setEdit({ name: '', description: '', sort_order: 0, is_active: true })}><Plus className="size-4" />Add category</button></PageHeader>
      <div className="panel">{data && <DataTable rows={data} onRowClick={setEdit} columns={[
        { key: 'sort_order', label: '#' }, { key: 'name', label: 'Name', render: (r) => <b>{r.name}</b> }, { key: 'slug', label: 'URL', render: (r) => `/shop/${r.slug}` },
        { key: 'product_count', label: 'Products' }, { key: 'is_active', label: 'Visible', render: (r) => <StatusBadge status={r.is_active ? 'active' : 'inactive'} /> },
        { key: 'del', label: '', render: (r) => <button className="text-ink-soft hover:text-danger" aria-label="Delete" onClick={(e) => { e.stopPropagation(); if (window.confirm(`Delete ${r.name}?`)) api.delete(`/admin/categories/${r.id}`).then(reload).catch((er) => toast(errMsg(er), 'danger')); }}><Trash2 className="size-4" /></button> },
      ]} />}</div>
      <Modal open={!!edit} onClose={() => setEdit(null)} title={edit?.id ? 'Edit category' : 'New category'} footer={<Button busy={busy} onClick={save}>Save</Button>}>
        {edit && <div className="space-y-3">
          <Input label="Name" value={edit.name} onChange={(e) => setEdit({ ...edit, name: e.target.value })} />
          <Textarea label="Description" value={edit.description || ''} onChange={(e) => setEdit({ ...edit, description: e.target.value })} />
          <Input label="Order" type="number" value={edit.sort_order} onChange={(e) => setEdit({ ...edit, sort_order: e.target.value })} />
          <Checkbox label="Visible in the store" checked={!!edit.is_active} onChange={(e) => setEdit({ ...edit, is_active: e.target.checked })} />
        </div>}
      </Modal>
    </>
  );
}
