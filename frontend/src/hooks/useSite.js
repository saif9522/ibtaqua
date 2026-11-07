import { useEffect, useState } from 'react';
import { useSelector } from 'react-redux';
import { api } from '../services/api';

let cache = null; let inflight = null;
/** Public business settings (brand, phone, WhatsApp, slots…), fetched once. */
export function useSite() {
  const [s, setS] = useState(cache);
  useEffect(() => {
    if (cache) return;
    inflight = inflight || api.get('/settings').then((r) => { cache = r.data; return cache; });
    inflight.then(setS).catch(() => setS({}));
  }, []);
  return s || {};
}

export const useAuth = () => {
  const { user, status } = useSelector((s) => s.auth);
  const role = user?.role;
  return {
    user, status, role,
    isStaff: ['super_admin', 'admin'].includes(role),
    isB2B: ['retailer', 'wholesaler', 'distributor'].includes(role),
    isBuyer: ['customer', 'retailer', 'wholesaler', 'distributor'].includes(role),
    can: (p) => !!user?.permissions?.includes(p),
  };
};

/** Map of productId → priced product for the current viewer's tier. */
export function useCatalogPrices(dep) {
  const [map, setMap] = useState({});
  const { user } = useSelector((s) => s.auth);
  useEffect(() => {
    api.get('/products?limit=100').then((r) => setMap(Object.fromEntries(r.data.data.map((p) => [p.id, p])))).catch(() => {});
  }, [user?.id, dep]);
  return map;
}

export const homeFor = (user) => {
  if (!user) return '/';
  if (['super_admin', 'admin'].includes(user.role)) return '/admin';
  if (user.role === 'delivery') return '/delivery';
  if (['retailer', 'wholesaler', 'distributor'].includes(user.role)) return '/business';
  return '/account';
};
