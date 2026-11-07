import { useState } from 'react';
import { Link } from 'react-router-dom';
import { AreaChart, Area, BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, CartesianGrid, Cell } from 'recharts';
import { AlertTriangle } from 'lucide-react';
import { useApi } from '../../hooks/useApi';
import { PageHeader, Loading, ErrorNote, Stat, StatusBadge, DataTable, Tabs } from '../../components/ui';
import { inr, ago, humanize, TIER_LABEL } from '../../utils/format';

const money = (v) => `₹${(v / 100).toLocaleString('en-IN', { maximumFractionDigits: 0 })}`;
const axisMoney = (v) => (v >= 100000 * 100 ? `₹${(v / 1e7).toFixed(1)}L` : v >= 100000 ? `₹${Math.round(v / 100000)}k` : `₹${Math.round(v / 100)}`);
const TIER_COLORS = { customer: '#0596B4', retailer: '#0A4A63', wholesaler: '#4FB8CE', distributor: '#E9A93A' };
const STATUS_COLORS = { delivered: '#138a5b', cancelled: '#c23a3a', pending: '#E9A93A', returned: '#9aa9b0' };

export default function Dashboard() {
  const { data, loading, error, reload } = useApi('/admin/dashboard', { poll: 60000 });
  const [range, setRange] = useState('daily');
  if (loading && !data) return <Loading />;
  if (error) return <ErrorNote onRetry={reload}>{error}</ErrorNote>;
  const s = data.stats; const c = data.charts;
  const series = c[range].map((d) => ({ ...d, label: range === 'daily' ? d.label.slice(5) : d.label }));
  const tierTotal = c.byTier.reduce((a, b) => a + b.revenue, 0) || 1;
  const alerts = [
    s.pendingApprovals && [`${s.pendingApprovals} partner applications waiting`, '/admin/retailers?status=pending'],
    s.pendingPayments && [`${s.pendingPayments} payments to verify`, '/admin/payments?status=pending_verification'],
    s.lowStock && [`${s.lowStock} products low on stock`, '/admin/inventory'],
  ].filter(Boolean);

  return (
    <>
      <PageHeader title="Dashboard" sub="Booked revenue excludes cancelled and returned orders." />
      {!!alerts.length && (
        <div className="mb-5 flex flex-wrap gap-2">{alerts.map(([t, to]) => <Link key={t} to={to} className="flex items-center gap-2 rounded-full bg-marigold-soft px-3.5 py-1.5 text-sm font-semibold text-[#7a540e] hover:bg-[#fbe6bd]"><AlertTriangle className="size-4" />{t}</Link>)}</div>
      )}
      <div className="panel grid grid-cols-2 divide-shoal sm:grid-cols-3 lg:grid-cols-6 [&>*]:border-b [&>*]:border-r [&>*]:border-shoal">
        <Stat label="Today's revenue" value={inr(s.todayRevenue)} />
        <Stat label="This month" value={inr(s.monthRevenue)} />
        <Stat label="Total revenue" value={inr(s.totalRevenue)} />
        <Stat label="Outstanding" value={inr(s.outstanding)} tone={s.outstanding ? 'warn' : undefined} />
        <Stat label="Orders to process" value={s.pendingOrders} note={`${s.totalOrders} total · ${s.deliveredOrders} delivered`} />
        <Stat label="Low stock" value={s.lowStock} tone={s.lowStock ? 'danger' : undefined} note={`${s.products} products`} />
        <Stat label="Customers" value={s.customers} />
        <Stat label="Retailers" value={s.retailers} />
        <Stat label="Wholesalers" value={s.wholesalers} />
        <Stat label="Distributors" value={s.distributors} />
        <Stat label="Approvals pending" value={s.pendingApprovals} tone={s.pendingApprovals ? 'warn' : undefined} />
        <Stat label="Payments to verify" value={s.pendingPayments} tone={s.pendingPayments ? 'warn' : undefined} />
      </div>

      <div className="mt-6 grid gap-5 xl:grid-cols-[1.7fr_1fr]">
        <section className="panel p-5">
          <div className="flex flex-wrap items-center justify-between gap-2"><h2 className="text-lg">Sales</h2>
            <div className="flex gap-1 rounded-lg bg-mist p-1 text-sm">{[['daily', '30 days'], ['monthly', '12 months'], ['yearly', 'Years']].map(([v, l]) => <button key={v} onClick={() => setRange(v)} className={`rounded-md px-3 py-1 font-semibold ${range === v ? 'bg-white text-depth shadow-sm' : 'text-ink-soft'}`}>{l}</button>)}</div>
          </div>
          <div className="mt-4 h-64">
            <ResponsiveContainer>
              <AreaChart data={series} margin={{ left: 0, right: 8 }}>
                <defs><linearGradient id="g" x1="0" x2="0" y1="0" y2="1"><stop offset="0" stopColor="#0596B4" stopOpacity=".3" /><stop offset="1" stopColor="#0596B4" stopOpacity="0" /></linearGradient></defs>
                <CartesianGrid vertical={false} stroke="#cfe6ee" />
                <XAxis dataKey="label" tick={{ fontSize: 11 }} tickLine={false} />
                <YAxis tick={{ fontSize: 11 }} tickFormatter={axisMoney} width={56} tickLine={false} axisLine={false} />
                <Tooltip formatter={(v, n) => (n === 'revenue' ? [money(v), 'Revenue'] : [v, 'Orders'])} />
                <Area type="monotone" dataKey="revenue" stroke="#0596B4" strokeWidth={2} fill="url(#g)" />
              </AreaChart>
            </ResponsiveContainer>
          </div>
        </section>
        <section className="panel p-5">
          <h2 className="text-lg">Revenue by buyer type</h2>
          <div className="mt-4 flex h-4 overflow-hidden rounded-full">{c.byTier.map((t) => <div key={t.label} style={{ width: `${(t.revenue / tierTotal) * 100}%`, background: TIER_COLORS[t.label] }} title={TIER_LABEL[t.label]} />)}</div>
          <ul className="mt-4 space-y-2.5 text-sm">{c.byTier.map((t) => (
            <li key={t.label} className="flex items-center gap-2"><span className="size-3 rounded-sm" style={{ background: TIER_COLORS[t.label] }} /><span className="flex-1">{TIER_LABEL[t.label]}</span><span className="text-ink-soft">{t.orders} orders</span><span className="w-24 text-right font-semibold">{inr(t.revenue)}</span><span className="w-10 text-right text-ink-soft">{Math.round((t.revenue / tierTotal) * 100)}%</span></li>
          ))}</ul>
          <h2 className="mt-7 text-lg">Order status</h2>
          <div className="mt-2 h-40">
            <ResponsiveContainer>
              <BarChart data={c.statusDist} layout="vertical" margin={{ left: 10 }}>
                <XAxis type="number" hide /><YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} tickFormatter={humanize} axisLine={false} tickLine={false} />
                <Tooltip formatter={(v) => [v, 'Orders']} labelFormatter={humanize} />
                <Bar dataKey="value" radius={[0, 4, 4, 0]}>{c.statusDist.map((d) => <Cell key={d.label} fill={STATUS_COLORS[d.label] || '#4FB8CE'} />)}</Bar>
              </BarChart>
            </ResponsiveContainer>
          </div>
        </section>
      </div>

      <div className="mt-5 grid gap-5 xl:grid-cols-[1fr_1.7fr]">
        <section className="panel p-5">
          <h2 className="text-lg">Best sellers</h2>
          <ol className="mt-3 space-y-3">{c.bestSellers.map((b, i) => {
            const max = c.bestSellers[0]?.quantity || 1;
            return (
              <li key={b.product_id} className="text-sm">
                <div className="flex justify-between gap-2"><span className="font-semibold">{i + 1}. {b.label}</span><span className="text-ink-soft">{b.quantity} units</span></div>
                <div className="mt-1 h-1.5 rounded-full bg-mist"><div className="h-full rounded-full bg-aqua" style={{ width: `${(b.quantity / max) * 100}%` }} /></div>
              </li>
            );
          })}</ol>
        </section>
        <section className="panel">
          <div className="flex items-center justify-between px-5 pt-4"><h2 className="text-lg">Latest orders</h2><Link to="/admin/orders" className="link text-sm">All orders</Link></div>
          <DataTable rows={data.recentOrders} columns={[
            { key: 'order_number', label: 'Order', render: (r) => <Link to={`/admin/orders/${r.id}`} className="link">{r.order_number}</Link> },
            { key: 'name', label: 'Buyer', render: (r) => <>{r.name} <span className="text-ink-soft">· {TIER_LABEL[r.buyer_tier]}</span></> },
            { key: 'grand_total', label: 'Total', render: (r) => inr(r.grand_total) },
            { key: 'status', label: 'Status', render: (r) => <StatusBadge status={r.status} /> },
            { key: 'created_at', label: '', render: (r) => <span className="text-ink-soft">{ago(r.created_at)}</span> },
          ]} />
        </section>
      </div>
    </>
  );
}
