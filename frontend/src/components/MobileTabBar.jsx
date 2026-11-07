import { NavLink, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { Home, Search, ShoppingBag, Package, User, Truck, ClipboardList, LayoutDashboard } from 'lucide-react';
import { cartActions } from '../redux/store';
import { useAuth, homeFor } from '../hooks/useSite';

const tab = 'relative flex flex-1 flex-col items-center gap-0.5 pt-2 pb-1.5 text-[11.5px] font-semibold';
const tone = ({ isActive }) => `${tab} ${isActive ? 'text-aqua-700' : 'text-ink-soft'}`;

/** App-style bottom navigation for phones (hidden from lg up). */
export default function MobileTabBar({ cartOpensDrawer = true }) {
  const { user, role, isB2B } = useAuth();
  const count = useSelector((s) => s.cart.items.reduce((n, i) => n + i.quantity, 0));
  const dispatch = useDispatch();
  const navigate = useNavigate();

  let items;
  if (role === 'delivery') {
    items = [['/delivery', "Today's run", Truck, true], ['/delivery/report', 'Report', ClipboardList], ['/', 'Store', Home, true]];
  } else {
    items = [
      ['/', 'Home', Home, true],
      ['/shop', 'Shop', Search],
      ['cart', 'Cart', ShoppingBag],
      ['/account/orders', 'Orders', Package],
      [user ? homeFor(user) : '/login', user ? (isB2B ? 'Business' : role === 'customer' ? 'Account' : 'Admin') : 'Log in', isB2B ? LayoutDashboard : User, true],
    ];
  }
  return (
    <nav aria-label="App" className="fixed inset-x-0 bottom-0 z-40 flex border-t border-shoal bg-white/97 pb-[env(safe-area-inset-bottom)] shadow-[0_-4px_16px_rgba(10,74,99,.06)] backdrop-blur lg:hidden">
      {items.map(([to, label, Icon, end]) => (to === 'cart' ? (
        <button key="cart" className={`${tab} text-ink-soft`} onClick={() => (cartOpensDrawer ? dispatch(cartActions.toggle(true)) : navigate('/checkout'))} aria-label={`Cart, ${count} items`}>
          <ShoppingBag className="size-[22px]" strokeWidth={1.9} />
          {count > 0 && <span className="absolute left-1/2 top-1 ml-1.5 grid min-w-[18px] place-items-center rounded-full bg-aqua px-1 text-[10.5px] font-bold text-white">{count}</span>}
          Cart
        </button>
      ) : (
        <NavLink key={label} to={to} end={end} className={tone}>
          {({ isActive }) => <>
            {isActive && <span className="absolute inset-x-5 top-0 h-[3px] rounded-b-full bg-aqua" />}
            <Icon className="size-[22px]" strokeWidth={isActive ? 2.3 : 1.9} />{label}
          </>}
        </NavLink>
      )))}
    </nav>
  );
}
