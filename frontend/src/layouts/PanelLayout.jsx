import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation } from 'react-router-dom';
import { useDispatch } from 'react-redux';
import { Menu, LogOut, Bell, Store } from 'lucide-react';
import { Logo } from '../components/Brand';
import MobileTabBar from '../components/MobileTabBar';
import { logout } from '../redux/store';
import { useAuth } from '../hooks/useSite';
import { useApi } from '../hooks/useApi';
import { humanize } from '../utils/format';

/**
 * Shared shell for admin, buyer account, business and delivery panels.
 * nav: [{ group?, items: [{ to, label, icon, perm?, badge? }] }]
 */
export default function PanelLayout({ nav, home, notificationsUrl, notificationsLink, title, tabBar }) {
  const { user, can } = useAuth();
  const dispatch = useDispatch();
  const [open, setOpen] = useState(false);
  const loc = useLocation();
  useEffect(() => { setOpen(false); }, [loc.pathname]);
  const notes = useApi(notificationsUrl, { poll: 30000, enabled: !!notificationsUrl });
  const unread = notes.data?.unread || 0;

  const side = (
    <div className="flex h-full flex-col">
      <div className="flex h-16 items-center px-5"><Logo to={home} /></div>
      <p className="px-5 pb-2 text-[12.5px] text-ink-soft">{title}</p>
      <nav className="flex-1 overflow-y-auto px-3 pb-6" aria-label={title}>
        {nav.map((g, gi) => {
          const items = g.items.filter((i) => !i.perm || can(i.perm));
          if (!items.length) return null;
          return (
            <div key={gi} className="mb-3">
              {g.group && <p className="px-3 pb-1 pt-3 text-[12px] font-semibold text-ink-soft/80">{g.group}</p>}
              {items.map(({ to, label, icon: Icon, end }) => (
                <NavLink key={to} to={to} end={end} className={({ isActive }) => `flex items-center gap-2.5 rounded-lg px-3 py-2 text-[14px] font-medium ${isActive ? 'bg-[#dff3f8] text-depth' : 'text-ink hover:bg-mist'}`}>
                  {Icon && <Icon className="size-[18px] text-aqua-700" strokeWidth={1.8} />}{label}
                </NavLink>
              ))}
            </div>
          );
        })}
      </nav>
      <div className="border-t border-shoal px-4 py-3">
        <p className="truncate text-sm font-semibold">{user?.name}</p>
        <p className="text-[12.5px] text-ink-soft">{humanize(user?.role)}{user?.business?.business_name ? ` · ${user.business.business_name}` : ''}</p>
        <div className="mt-2 flex gap-2">
          <Link to="/" className="btn-outline btn-sm flex-1"><Store className="size-4" />Store</Link>
          <button className="btn-outline btn-sm flex-1" onClick={() => dispatch(logout())}><LogOut className="size-4" />Log out</button>
        </div>
      </div>
    </div>
  );

  return (
    <div className="min-h-screen bg-mist/60">
      <aside className="fixed inset-y-0 left-0 z-30 hidden w-64 border-r border-shoal bg-white lg:block">{side}</aside>
      {open && (
        <div className="fixed inset-0 z-40 bg-depth/30 lg:hidden" onClick={() => setOpen(false)}>
          <aside className="h-full w-72 bg-white shadow-xl" onClick={(e) => e.stopPropagation()}>{side}</aside>
        </div>
      )}
      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-14 items-center gap-3 border-b border-shoal bg-white/95 px-4 backdrop-blur lg:px-8">
          <button className="lg:hidden" onClick={() => setOpen(true)} aria-label="Open menu"><Menu className="size-6 text-depth" /></button>
          <div className="lg:hidden"><Logo to={home} /></div>
          <div className="ml-auto flex items-center gap-2">
            {notificationsLink && (
              <Link to={notificationsLink} className="btn-ghost btn-sm relative" aria-label={`Notifications, ${unread} unread`}>
                <Bell className="size-5" />
                {unread > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-marigold px-1 text-[11px] font-bold text-white">{unread > 99 ? '99+' : unread}</span>}
              </Link>
            )}
          </div>
        </header>
        <main className={`mx-auto max-w-7xl px-4 py-6 lg:px-8 ${tabBar ? 'pb-24 lg:pb-6' : ''}`}><Outlet /></main>
      </div>
      {tabBar && <MobileTabBar cartOpensDrawer={false} />}
    </div>
  );
}
