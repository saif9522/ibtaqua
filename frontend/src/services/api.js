import axios from 'axios';

const TOKENS = 'ibt.tokens';
export const tokenStore = {
  get: () => { try { return JSON.parse(localStorage.getItem(TOKENS)) || {}; } catch { return {}; } },
  set: (t) => { try { localStorage.setItem(TOKENS, JSON.stringify(t)); } catch { /* storage blocked */ } },
  clear: () => { try { localStorage.removeItem(TOKENS); } catch { /* ignore */ } },
};

export const api = axios.create({ baseURL: import.meta.env.VITE_API_URL || '/api', timeout: 30000 });

api.interceptors.request.use((cfg) => {
  const { accessToken } = tokenStore.get();
  if (accessToken) cfg.headers.Authorization = `Bearer ${accessToken}`;
  return cfg;
});

// One refresh in flight at a time; queued requests retry with the new token.
let refreshing = null;
let onLogout = () => {};
export const setLogoutHandler = (fn) => { onLogout = fn; };

api.interceptors.response.use((r) => r, async (error) => {
  const original = error.config;
  const { refreshToken } = tokenStore.get();
  if (error.response?.status === 401 && refreshToken && !original._retry && !original.url.includes('/auth/')) {
    original._retry = true;
    try {
      refreshing = refreshing || api.post('/auth/refresh', { refreshToken }).then((r) => { tokenStore.set(r.data); return r.data; }).finally(() => { refreshing = null; });
      const t = await refreshing;
      original.headers.Authorization = `Bearer ${t.accessToken}`;
      return api(original);
    } catch {
      tokenStore.clear();
      onLogout();
    }
  }
  return Promise.reject(error);
});

export const errMsg = (e, fallback = 'Something went wrong. Please try again.') =>
  e?.response?.data?.error?.message || (e?.code === 'ECONNABORTED' ? 'The server took too long to respond.' : e?.message === 'Network Error' ? 'Cannot reach the server. Check your connection.' : fallback);
export const errFields = (e) => Object.fromEntries((e?.response?.data?.error?.fields || []).map((f) => [f.path, f.message]));

/** Download an authenticated file (invoice PDF, report export). */
export async function download(url, filename) {
  const r = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(r.data);
  const a = Object.assign(document.createElement('a'), { href, download: filename });
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(href), 2000);
}
export async function openBlob(url) {
  const w = window.open('', '_blank');
  const r = await api.get(url, { responseType: 'blob' });
  const href = URL.createObjectURL(r.data);
  if (w) w.location.href = href; else window.location.href = href;
}
