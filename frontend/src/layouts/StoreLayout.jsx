import { useEffect, useState } from 'react';
import { Link, NavLink, Outlet, useLocation, useNavigate } from 'react-router-dom';
import { useDispatch, useSelector } from 'react-redux';
import { ShoppingBag, User, Menu, X, MessageCircle, Phone, Mail, MapPin, Trash2 } from 'lucide-react';
import { Logo } from '../components/Brand';
import MobileTabBar from '../components/MobileTabBar';
import { QtyStepper } from '../components/ui';
import { cartActions, logout } from '../redux/store';
import { useAuth, useSite, homeFor, useCatalogPrices } from '../hooks/useSite';
import { inr, imgUrl } from '../utils/format';

const NAV = [['/shop', 'Shop'], ['/shop/20-litre-jar', '20L jars'], ['/bulk-orders', 'Bulk orders'], ['/partners', 'Become a partner'], ['/about', 'About'], ['/track', 'Track order']];

function CartDrawer() {
  const { items, open } = useSelector((s) => s.cart);
  const dispatch = useDispatch();
  const navigate = useNavigate();
  const prices = useCatalogPrices(open);
  if (!open) return null;
  const total = items.reduce((s, i) => s + (prices[i.productId]?.price?.unitPrice || 0) * i.quantity, 0);
  return (
    <div className="fixed inset-0 z-50 flex justify-end bg-depth/30" onMouseDown={(e) => e.target === e.currentTarget && dispatch(cartActions.toggle(false))}>
      <aside className="flex h-full w-full max-w-md flex-col bg-white shadow-2xl" aria-label="Cart">
        <div className="flex items-center justify-between border-b border-shoal px-5 py-4">
          <h2 className="text-xl">Your cart</h2>
          <button className="btn-ghost btn-sm" onClick={() => dispatch(cartActions.toggle(false))} aria-label="Close cart"><X className="size-5" /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5">
          {!items.length && <p className="py-16 text-center text-ink-soft">Your cart is empty. Add bottles or a jar refill to get started.</p>}
          {items.map((i) => {
            const p = prices[i.productId];
            return (
              <div key={i.productId} className="flex gap-3 border-b border-shoal/70 py-4">
                <img src={imgUrl(i.image)} alt="" className="size-16 rounded-lg bg-mist object-cover" />
                <div className="flex-1">
                  <p className="text-sm font-semibold leading-snug">{i.name}</p>
                  <p className="text-[13px] text-ink-soft">{p?.price ? `${inr(p.price.unitPrice)} each` : 'Price at checkout'}</p>
                  <div className="mt-2 flex items-center gap-3">
                    <QtyStepper value={i.quantity} min={p?.price?.minOrderQty || 1} onChange={(q) => dispatch(cartActions.setQty({ productId: i.productId, quantity: q }))} />
                    <button className="text-ink-soft hover:text-danger" onClick={() => dispatch(cartActions.remove(i.productId))} aria-label={`Remove ${i.name}`}><Trash2 className="size-4" /></button>
                  </div>
                </div>
              </div>
            );
          })}
        </div>
        {!!items.length && (
          <div className="border-t border-shoal px-5 py-4">
            <div className="mb-3 flex justify-between text-sm"><span className="text-ink-soft">Items total (incl. GST)</span><span className="font-display text-lg font-bold text-depth">{inr(total)}</span></div>
            <p className="mb-3 text-[12.5px] text-ink-soft">Delivery charge, jar deposit and coupons are worked out at checkout.</p>
            <button className="btn-primary w-full" onClick={() => { dispatch(cartActions.toggle(false)); navigate('/checkout'); }}>Checkout</button>
          </div>
        )}
      </aside>
    </div>
  );
}

export default function StoreLayout() {
  const { user, isBuyer } = useAuth();
  const count = useSelector((s) => s.cart.items.reduce((n, i) => n + i.quantity, 0));
  const dispatch = useDispatch();
  const site = useSite();
  const biz = site.business_profile || {};
  const [menu, setMenu] = useState(false);
  const loc = useLocation();
  useEffect(() => { setMenu(false); window.scrollTo(0, 0); }, [loc.pathname]);
  const wa = biz.whatsapp ? `https://wa.me/91${biz.whatsapp}?text=${encodeURIComponent('Hi IBT AQUA, I would like to order water.')}` : null;

  return (
    <div className="flex min-h-screen flex-col">
      <a href="#main" className="sr-only focus:not-sr-only focus:absolute focus:left-2 focus:top-2 focus:z-50 focus:rounded focus:bg-white focus:px-3 focus:py-2">Skip to content</a>
      <header className="sticky top-0 z-40 border-b border-shoal/80 bg-white/95 backdrop-blur">
        <div className="mx-auto flex h-16 max-w-7xl items-center gap-6 px-4">
          <button className="lg:hidden" onClick={() => setMenu(!menu)} aria-label="Menu" aria-expanded={menu}><Menu className="size-6 text-depth" /></button>
          <Logo />
          <nav className="hidden flex-1 items-center gap-1 lg:flex" aria-label="Main">
            {NAV.map(([to, label]) => (
              <NavLink key={to} to={to} end className={({ isActive }) => `rounded-lg px-3 py-2 text-sm font-semibold ${isActive ? 'text-aqua-700' : 'text-ink hover:text-aqua-700'}`}>{label}</NavLink>
            ))}
          </nav>
          <div className="ml-auto flex items-center gap-1">
            {user ? (
              <Link to={homeFor(user)} className="btn-ghost btn-sm hidden lg:inline-flex"><User className="size-4" /><span className="hidden sm:inline">{user.name.split(' ')[0]}</span></Link>
            ) : (
              <Link to="/login" className="btn-primary btn-sm">Log in</Link>
            )}
            {(!user || isBuyer) && (
              <button className="btn-ghost btn-sm relative hidden lg:inline-flex" onClick={() => dispatch(cartActions.toggle(true))} aria-label={`Cart, ${count} items`}>
                <ShoppingBag className="size-5" />
                {count > 0 && <span className="absolute -right-0.5 -top-0.5 grid min-w-5 place-items-center rounded-full bg-aqua px-1 text-[11px] font-bold text-white">{count}</span>}
              </button>
            )}
          </div>
        </div>
        {menu && (
          <nav className="border-t border-shoal bg-white px-4 py-3 lg:hidden" aria-label="Mobile">
            {NAV.map(([to, label]) => <Link key={to} to={to} className="block rounded-lg px-2 py-2.5 font-semibold text-ink">{label}</Link>)}
            {user && <button className="mt-2 px-2 text-sm text-ink-soft" onClick={() => dispatch(logout())}>Log out</button>}
          </nav>
        )}
      </header>

      <main id="main" className="flex-1 pb-4"><Outlet /></main>

      <footer className="mt-16 bg-depth pb-20 text-[#cfe6ee] lg:pb-0">
        <div className="mx-auto grid max-w-7xl gap-10 px-4 py-12 sm:grid-cols-2 lg:grid-cols-4">
          <div>
            <Logo light />
            <p className="mt-3 max-w-xs text-sm">{biz.tagline || 'Pure. Safe. Delivered.'} Packaged drinking water made by {biz.legal_name || 'IBT ENTERPRISES'}, {biz.district || 'Palamu'}, Jharkhand.</p>
            {(biz.fssai || biz.bis_license) && <p className="mt-3 text-[12.5px] text-[#9fc3cf]">{biz.bis_license && `BIS licence ${biz.bis_license}`}{biz.bis_license && biz.fssai && '  ·  '}{biz.fssai && `FSSAI ${biz.fssai}`}</p>}
          </div>
          <div>
            <h3 className="mb-3 text-base text-white">Shop</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/shop/20-litre-jar" className="hover:text-white">20 litre jars</Link></li>
              <li><Link to="/shop/1-litre" className="hover:text-white">1 litre bottles</Link></li>
              <li><Link to="/shop/500ml" className="hover:text-white">500 ml bottles</Link></li>
              <li><Link to="/bulk-orders" className="hover:text-white">Bulk and event supply</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-base text-white">Help</h3>
            <ul className="space-y-2 text-sm">
              <li><Link to="/track" className="hover:text-white">Track an order</Link></li>
              <li><Link to="/faq" className="hover:text-white">FAQ</Link></li>
              <li><Link to="/contact" className="hover:text-white">Contact us</Link></li>
              <li><Link to="/page/refund-policy" className="hover:text-white">Refund and return policy</Link></li>
              <li><Link to="/page/terms" className="hover:text-white">Terms and conditions</Link></li>
              <li><Link to="/page/privacy-policy" className="hover:text-white">Privacy policy</Link></li>
            </ul>
          </div>
          <div>
            <h3 className="mb-3 text-base text-white">Reach us</h3>
            <ul className="space-y-2.5 text-sm">
              {biz.phone && <li className="flex gap-2"><Phone className="size-4 shrink-0" /><a href={`tel:+91${biz.phone}`} className="hover:text-white">+91 {biz.phone}</a></li>}
              {biz.email && <li className="flex gap-2"><Mail className="size-4 shrink-0" /><a href={`mailto:${biz.email}`} className="hover:text-white">{biz.email}</a></li>}
              <li className="flex gap-2"><MapPin className="size-4 shrink-0" /><span>{[biz.address, biz.city, biz.state, biz.pincode].filter(Boolean).join(', ') || 'Palamu, Jharkhand'}</span></li>
            </ul>
          </div>
        </div>
        <div className="border-t border-white/10 px-4 py-4 text-center text-[12.5px] text-[#9fc3cf]">© {new Date().getFullYear()} {biz.legal_name || 'IBT ENTERPRISES'}. All rights reserved.</div>
      </footer>

      {wa && (
        <a href={wa} target="_blank" rel="noreferrer" className="fixed bottom-20 right-4 z-30 flex lg:bottom-5 lg:right-5 items-center gap-2 rounded-full bg-[#1fa855] px-4 py-3 text-sm font-semibold text-white shadow-lg hover:bg-[#178a45]" aria-label="Chat on WhatsApp">
          <MessageCircle className="size-5" /><span className="hidden sm:inline">Order on WhatsApp</span>
        </a>
      )}
      <CartDrawer />
      <MobileTabBar />
    </div>
  );
}
