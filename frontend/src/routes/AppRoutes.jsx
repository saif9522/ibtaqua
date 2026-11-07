import { Navigate, Route, Routes, useLocation } from 'react-router-dom';
import {
  LayoutDashboard, Package, FolderTree, ShoppingCart, Users, Store, Warehouse, Truck, Boxes, Factory, Repeat, CreditCard, FileText, TicketPercent,
  CalendarClock, MapPinned, BarChart3, Bell, LayoutTemplate, Settings as Cog, ShieldCheck, History, LifeBuoy, Wallet, Home as HomeIcon, MapPin,
  Droplets, UserCircle, Zap, ScrollText, FileUp, Route as RouteIcon, ClipboardList, Network,
} from 'lucide-react';
import { useAuth } from '../hooks/useSite';
import { Loading } from '../components/ui';
import StoreLayout from '../layouts/StoreLayout';
import PanelLayout from '../layouts/PanelLayout';
import Home from '../pages/store/Home';
import Shop from '../pages/store/Shop';
import ProductDetail from '../pages/store/ProductDetail';
import Login from '../pages/store/Login';
import Partners from '../pages/store/Partners';
import Checkout from '../pages/store/Checkout';
import { CmsPage, Faq, Contact, BulkOrders, TrackOrder } from '../pages/store/Content';
import { OrderList, OrderDetail } from '../pages/account/Orders';
import { Overview, Addresses, Subscriptions, Support, Notifications, Jars, Profile } from '../pages/account/Account';
import { BusinessHome, QuickOrder, Statement, Documents } from '../pages/partner/Business';
import { DeliveryRun, DeliveryHistory } from '../pages/delivery/Delivery';
import Dashboard from '../pages/admin/Dashboard';
import * as AO from '../pages/admin/Orders';
import * as AC from '../pages/admin/Catalog';
import * as AU from '../pages/admin/Users';
import * as AI from '../pages/admin/Inventory';
import * as AF from '../pages/admin/Finance';
import * as AS from '../pages/admin/System';

/** Gate by role. `allowPending` lets B2B applicants reach their documents page. */
function Guard({ roles, allowPending, children }) {
  const { user, status } = useAuth();
  const loc = useLocation();
  if (status === 'loading') return <Loading />;
  if (!user) return <Navigate to="/login" state={{ from: loc.pathname + loc.search }} replace />;
  if (!roles.includes(user.role)) return <Navigate to="/" replace />;
  if (['pending', 'rejected'].includes(user.status) && !allowPending) return <Navigate to="/business/documents" replace />;
  return children;
}

const ADMIN_NAV = [
  { items: [{ to: '/admin', label: 'Dashboard', icon: LayoutDashboard, end: true, perm: 'dashboard.view' }] },
  { group: 'Catalog', items: [
    { to: '/admin/products', label: 'Products', icon: Package, perm: 'products.read' },
    { to: '/admin/categories', label: 'Categories', icon: FolderTree, perm: 'products.read' },
  ] },
  { group: 'Sales', items: [
    { to: '/admin/orders', label: 'Orders', icon: ShoppingCart, perm: 'orders.read' },
    { to: '/admin/customers', label: 'Customers', icon: Users, perm: 'users.read' },
    { to: '/admin/retailers', label: 'Retailers', icon: Store, perm: 'users.read' },
    { to: '/admin/wholesalers', label: 'Wholesalers', icon: Warehouse, perm: 'users.read' },
    { to: '/admin/distributors', label: 'Distributors', icon: Network, perm: 'users.read' },
    { to: '/admin/credit-requests', label: 'Credit requests', icon: Wallet, perm: 'partners.approve' },
  ] },
  { group: 'Operations', items: [
    { to: '/admin/delivery-staff', label: 'Delivery staff', icon: Truck, perm: 'delivery.manage' },
    { to: '/admin/delivery-board', label: 'Delivery board', icon: RouteIcon, perm: 'delivery.manage' },
    { to: '/admin/inventory', label: 'Inventory', icon: Boxes, perm: 'inventory.read' },
    { to: '/admin/batches', label: 'Manufacturing & batches', icon: Factory, perm: 'inventory.read' },
    { to: '/admin/jars', label: 'Empty jar management', icon: Repeat, perm: 'jars.write' },
    { to: '/admin/subscriptions', label: 'Subscriptions', icon: CalendarClock, perm: 'subscriptions.manage' },
    { to: '/admin/zones', label: 'Delivery zones', icon: MapPinned, perm: 'delivery.manage' },
  ] },
  { group: 'Money', items: [
    { to: '/admin/payments', label: 'Payments', icon: CreditCard, perm: 'payments.read' },
    { to: '/admin/invoices', label: 'Invoices', icon: FileText, perm: 'orders.read' },
    { to: '/admin/coupons', label: 'Coupons', icon: TicketPercent, perm: 'coupons.write' },
    { to: '/admin/reports', label: 'Reports', icon: BarChart3, perm: 'reports.view' },
  ] },
  { group: 'System', items: [
    { to: '/admin/support', label: 'Support & returns', icon: LifeBuoy, perm: 'support.manage' },
    { to: '/admin/notifications', label: 'Notifications', icon: Bell, perm: 'dashboard.view' },
    { to: '/admin/cms', label: 'Website CMS', icon: LayoutTemplate, perm: 'cms.write' },
    { to: '/admin/settings', label: 'Settings', icon: Cog, perm: 'dashboard.view' },
    { to: '/admin/admins', label: 'Admin users', icon: ShieldCheck, perm: 'admins.manage' },
    { to: '/admin/activity', label: 'Activity logs', icon: History, perm: 'audit.read' },
  ] },
];
const ACCOUNT_NAV = [{ items: [
  { to: '/account', label: 'Overview', icon: HomeIcon, end: true }, { to: '/account/orders', label: 'My orders', icon: ShoppingCart },
  { to: '/account/subscriptions', label: 'Subscriptions', icon: CalendarClock }, { to: '/account/jars', label: 'Jar balance', icon: Droplets },
  { to: '/account/addresses', label: 'Addresses', icon: MapPin }, { to: '/account/support', label: 'Support', icon: LifeBuoy },
  { to: '/account/notifications', label: 'Notifications', icon: Bell }, { to: '/account/profile', label: 'Profile', icon: UserCircle },
] }];
const BUSINESS_NAV = [
  { items: [{ to: '/business', label: 'Dashboard', icon: LayoutDashboard, end: true }, { to: '/business/quick-order', label: 'Quick order', icon: Zap }, { to: '/account/orders', label: 'Orders & tracking', icon: ShoppingCart }] },
  { group: 'Account', items: [
    { to: '/business/statement', label: 'Statement & payments', icon: ScrollText }, { to: '/account/subscriptions', label: 'Recurring supply', icon: CalendarClock },
    { to: '/account/jars', label: 'Jar balance', icon: Droplets }, { to: '/account/addresses', label: 'Delivery addresses', icon: MapPin },
    { to: '/business/documents', label: 'Documents', icon: FileUp }, { to: '/account/support', label: 'Contact sales & support', icon: LifeBuoy },
    { to: '/account/notifications', label: 'Notifications', icon: Bell }, { to: '/account/profile', label: 'Profile', icon: UserCircle },
  ] },
];
const DELIVERY_NAV = [{ items: [{ to: '/delivery', label: "Today's run", icon: Truck, end: true }, { to: '/delivery/report', label: 'Report & history', icon: ClipboardList }] }];

const BUYERS = ['customer', 'retailer', 'wholesaler', 'distributor'];
const B2B = ['retailer', 'wholesaler', 'distributor'];
const STAFF = ['super_admin', 'admin'];

function AccountShell() {
  const { isB2B } = useAuth();
  return isB2B
    ? <PanelLayout nav={BUSINESS_NAV} home="/business" title="Business account" notificationsUrl="/account/notifications" notificationsLink="/account/notifications" tabBar />
    : <PanelLayout nav={ACCOUNT_NAV} home="/account" title="My account" notificationsUrl="/account/notifications" notificationsLink="/account/notifications" tabBar />;
}

export default function AppRoutes() {
  return (
    <Routes>
      <Route element={<StoreLayout />}>
        <Route index element={<Home />} />
        <Route path="shop" element={<Shop />} />
        <Route path="shop/:category" element={<Shop />} />
        <Route path="product/:slug" element={<ProductDetail />} />
        <Route path="login" element={<Login />} />
        <Route path="register" element={<Login />} />
        <Route path="partners" element={<Partners />} />
        <Route path="retailer-registration" element={<Navigate to="/partners?type=retailer" replace />} />
        <Route path="wholesaler-registration" element={<Navigate to="/partners?type=wholesaler" replace />} />
        <Route path="bulk-orders" element={<BulkOrders />} />
        <Route path="contact" element={<Contact />} />
        <Route path="faq" element={<Faq />} />
        <Route path="about" element={<CmsPage slug="about" />} />
        <Route path="page/:slug" element={<CmsPage />} />
        <Route path="track" element={<TrackOrder />} />
        <Route path="cart" element={<Checkout />} />
        <Route path="checkout" element={<Checkout />} />
      </Route>

      <Route element={<Guard roles={BUYERS}><AccountShell /></Guard>}>
        <Route path="account" element={<Overview />} />
        <Route path="account/orders" element={<OrderList />} />
        <Route path="account/orders/:id" element={<OrderDetail />} />
        <Route path="account/addresses" element={<Addresses />} />
        <Route path="account/subscriptions" element={<Subscriptions />} />
        <Route path="account/support" element={<Support />} />
        <Route path="account/notifications" element={<Notifications />} />
        <Route path="account/jars" element={<Jars />} />
        <Route path="account/profile" element={<Profile />} />
        <Route path="business" element={<Guard roles={B2B}><BusinessHome /></Guard>} />
        <Route path="business/quick-order" element={<Guard roles={B2B}><QuickOrder /></Guard>} />
        <Route path="business/statement" element={<Guard roles={B2B}><Statement /></Guard>} />
      </Route>
      <Route element={<Guard roles={B2B} allowPending><PanelLayout nav={BUSINESS_NAV} home="/business" title="Business account" /></Guard>}>
        <Route path="business/documents" element={<Documents />} />
      </Route>

      <Route element={<Guard roles={['delivery']}><PanelLayout nav={DELIVERY_NAV} home="/delivery" title="Delivery partner" tabBar /></Guard>}>
        <Route path="delivery" element={<DeliveryRun />} />
        <Route path="delivery/report" element={<DeliveryHistory />} />
      </Route>

      <Route path="admin" element={<Guard roles={STAFF}><PanelLayout nav={ADMIN_NAV} home="/admin" title="IBT AQUA admin" notificationsUrl="/admin/notifications" notificationsLink="/admin/notifications" /></Guard>}>
        <Route index element={<Dashboard />} />
        <Route path="products" element={<AC.Products />} />
        <Route path="products/:id" element={<AC.ProductEditor />} />
        <Route path="categories" element={<AC.Categories />} />
        <Route path="orders" element={<AO.OrderList />} />
        <Route path="orders/:id" element={<AO.OrderDetail />} />
        <Route path="customers" element={<AU.UserList role="customer" key="c" />} />
        <Route path="retailers" element={<AU.UserList role="retailer" key="r" />} />
        <Route path="wholesalers" element={<AU.UserList role="wholesaler" key="w" />} />
        <Route path="distributors" element={<AU.UserList role="distributor" key="d" />} />
        <Route path="delivery-staff" element={<AU.UserList role="delivery" key="ds" />} />
        <Route path="users/:id" element={<AU.UserDetail />} />
        <Route path="credit-requests" element={<AU.CreditRequests />} />
        <Route path="admins" element={<AU.Admins />} />
        <Route path="inventory" element={<AI.InventoryPage />} />
        <Route path="batches" element={<AI.Batches />} />
        <Route path="jars" element={<AI.Jars />} />
        <Route path="payments" element={<AF.Payments />} />
        <Route path="invoices" element={<AF.Invoices />} />
        <Route path="coupons" element={<AF.Coupons />} />
        <Route path="reports" element={<AF.Reports />} />
        <Route path="subscriptions" element={<AF.Subscriptions />} />
        <Route path="zones" element={<AF.Zones />} />
        <Route path="delivery-board" element={<AF.DeliveryBoard />} />
        <Route path="notifications" element={<AS.NotificationsAdmin />} />
        <Route path="cms" element={<AS.Cms />} />
        <Route path="settings" element={<AS.Settings />} />
        <Route path="activity" element={<AS.ActivityLogs />} />
        <Route path="support" element={<AS.Support />} />
      </Route>
      <Route path="*" element={<StoreLayout />}><Route path="*" element={<div className="mx-auto max-w-xl px-4 py-24 text-center"><h1 className="text-4xl">Page not found</h1><p className="mt-2 text-ink-soft">The link may be old. Try the shop or your account.</p><a href="/shop" className="btn-primary mt-6">Go to shop</a></div>} /></Route>
    </Routes>
  );
}
