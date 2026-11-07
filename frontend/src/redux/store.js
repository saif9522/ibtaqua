import { configureStore, createSlice, createAsyncThunk } from '@reduxjs/toolkit';
import { api, tokenStore } from '../services/api';

// ---------- Auth ----------
export const loadMe = createAsyncThunk('auth/me', async () => (await api.get('/auth/me')).data.user);
export const logout = createAsyncThunk('auth/logout', async () => {
  const { refreshToken } = tokenStore.get();
  tokenStore.clear();
  await api.post('/auth/logout', { refreshToken }).catch(() => {});
});

const auth = createSlice({
  name: 'auth',
  initialState: { user: null, status: tokenStore.get().accessToken ? 'loading' : 'guest' },
  reducers: {
    loggedIn: (s, a) => { tokenStore.set({ accessToken: a.payload.accessToken, refreshToken: a.payload.refreshToken }); s.user = a.payload.user; s.status = 'ready'; },
    setUser: (s, a) => { s.user = a.payload; },
    sessionEnded: (s) => { s.user = null; s.status = 'guest'; },
  },
  extraReducers: (b) => {
    b.addCase(loadMe.fulfilled, (s, a) => { s.user = a.payload; s.status = 'ready'; });
    b.addCase(loadMe.rejected, (s) => { s.user = null; s.status = 'guest'; });
    b.addCase(logout.pending, (s) => { s.user = null; s.status = 'guest'; });
  },
});

// ---------- Cart (client holds only product ids + qty; prices always come from the server) ----------
const CART = 'ibt.cart';
const readCart = () => { try { return JSON.parse(localStorage.getItem(CART)) || []; } catch { return []; } };
const cart = createSlice({
  name: 'cart',
  initialState: { items: readCart(), open: false },
  reducers: {
    add: (s, a) => {
      const { product, quantity } = a.payload;
      const ex = s.items.find((i) => i.productId === product.id);
      if (ex) ex.quantity += quantity;
      else s.items.push({ productId: product.id, quantity, name: product.name, image: product.image, slug: product.slug, minQty: product.price?.minOrderQty || 1 });
      s.open = true;
    },
    setQty: (s, a) => { const i = s.items.find((x) => x.productId === a.payload.productId); if (i) i.quantity = Math.max(1, a.payload.quantity); },
    remove: (s, a) => { s.items = s.items.filter((i) => i.productId !== a.payload); },
    replace: (s, a) => { s.items = a.payload; },
    clear: (s) => { s.items = []; },
    toggle: (s, a) => { s.open = a.payload ?? !s.open; },
  },
});

// ---------- Toasts ----------
let tid = 0;
const ui = createSlice({
  name: 'ui',
  initialState: { toasts: [] },
  reducers: {
    pushToast: { reducer: (s, a) => { s.toasts.push(a.payload); }, prepare: (message, tone = 'ok') => ({ payload: { id: ++tid, message, tone } }) },
    dropToast: (s, a) => { s.toasts = s.toasts.filter((t) => t.id !== a.payload); },
  },
});

export const store = configureStore({ reducer: { auth: auth.reducer, cart: cart.reducer, ui: ui.reducer } });
store.subscribe(() => { try { localStorage.setItem(CART, JSON.stringify(store.getState().cart.items)); } catch { /* ignore */ } });

export const { loggedIn, setUser, sessionEnded } = auth.actions;
export const cartActions = cart.actions;
export const { pushToast, dropToast } = ui.actions;
export const toast = (m, tone) => store.dispatch(pushToast(m, tone));
