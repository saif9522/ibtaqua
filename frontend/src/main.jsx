import { StrictMode, useEffect } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router-dom';
import { Provider, useDispatch } from 'react-redux';
import './index.css';
import { store, loadMe, sessionEnded } from './redux/store';
import { setLogoutHandler, tokenStore } from './services/api';
import AppRoutes from './routes/AppRoutes';
import { Toasts } from './components/ui';

setLogoutHandler(() => store.dispatch(sessionEnded()));

function Boot() {
  const dispatch = useDispatch();
  useEffect(() => { if (tokenStore.get().accessToken) dispatch(loadMe()); }, [dispatch]);
  return <><AppRoutes /><Toasts /></>;
}

createRoot(document.getElementById('root')).render(
  <StrictMode>
    <Provider store={store}>
      <BrowserRouter>
        <Boot />
      </BrowserRouter>
    </Provider>
  </StrictMode>,
);
