import { useCallback, useEffect, useRef, useState } from 'react';
import { api, errMsg } from '../services/api';

/** GET a URL; re-fetches when url changes. `poll` (ms) keeps it live. */
export function useApi(url, { poll, enabled = true } = {}) {
  const [data, setData] = useState(null);
  const [error, setError] = useState(null);
  const [loading, setLoading] = useState(!!url && enabled);
  const alive = useRef(true);
  const load = useCallback(async (silent) => {
    if (!url || !enabled) return;
    if (!silent) setLoading(true);
    try { const r = await api.get(url); if (alive.current) { setData(r.data); setError(null); } } catch (e) { if (alive.current) setError(errMsg(e)); } finally { if (alive.current) setLoading(false); }
  }, [url, enabled]);
  useEffect(() => { alive.current = true; load(); return () => { alive.current = false; }; }, [load]);
  useEffect(() => {
    if (!poll) return undefined;
    const t = setInterval(() => { if (document.visibilityState === 'visible') load(true); }, poll);
    return () => clearInterval(t);
  }, [poll, load]);
  return { data, error, loading, reload: () => load(true), setData };
}

/** Wraps a mutating call with busy state and error capture. */
export function useAction() {
  const [busy, setBusy] = useState(false);
  const run = useCallback(async (fn) => { setBusy(true); try { return await fn(); } finally { setBusy(false); } }, []);
  return [run, busy];
}

export function useDebounced(value, ms = 300) {
  const [v, setV] = useState(value);
  useEffect(() => { const t = setTimeout(() => setV(value), ms); return () => clearTimeout(t); }, [value, ms]);
  return v;
}
