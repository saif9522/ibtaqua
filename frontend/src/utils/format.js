// Money arrives from the API as integer paise.
export const inr = (paise, { decimals } = {}) => {
  if (paise == null || Number.isNaN(paise)) return '—';
  const r = paise / 100;
  const d = decimals ?? (Number.isInteger(r) ? 0 : 2);
  return `₹${r.toLocaleString('en-IN', { minimumFractionDigits: d, maximumFractionDigits: d })}`;
};
export const toPaise = (rupees) => Math.round(Number(rupees || 0) * 100);
export const toRupees = (paise) => (paise == null ? '' : paise / 100);

const asDate = (s) => (s ? new Date(String(s).includes('T') ? s : `${String(s).replace(' ', 'T')}${String(s).length > 10 ? 'Z' : ''}`) : null);
export const date = (s) => (s ? asDate(s).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' }) : '—');
export const dateTime = (s) => (s ? asDate(s).toLocaleString('en-IN', { day: 'numeric', month: 'short', hour: 'numeric', minute: '2-digit' }) : '—');
export const ago = (s) => {
  const d = asDate(s); if (!d) return '';
  const m = Math.round((Date.now() - d) / 60000);
  if (m < 1) return 'just now'; if (m < 60) return `${m} min ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h} h ago`;
  return date(s);
};
export const todayISO = () => new Date(Date.now() + 5.5 * 3600e3).toISOString().slice(0, 10);
export const size = (ml) => (ml >= 1000 ? `${ml / 1000} L` : `${ml} ml`);
export const humanize = (s) => (s ? String(s).replace(/_/g, ' ').replace(/^\w/, (c) => c.toUpperCase()) : '');
export const imgUrl = (p) => p || '/brand/products/ibt-1l-1.svg';

export const ORDER_STEPS = ['pending', 'confirmed', 'processing', 'packed', 'ready_for_dispatch', 'dispatched', 'out_for_delivery', 'delivered'];
export const TIER_LABEL = { customer: 'Customer', retailer: 'Retailer', wholesaler: 'Wholesaler', distributor: 'Distributor' };
