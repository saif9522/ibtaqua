// Role → tier mapping. Tier decides which price list a buyer sees.
const ROLES = {
  super_admin: { label: 'Super Admin', staff: true },
  admin: { label: 'Admin', staff: true },
  delivery: { label: 'Delivery Staff', staff: true },
  customer: { label: 'Customer', tier: 'customer' },
  retailer: { label: 'Retailer', tier: 'retailer' },
  wholesaler: { label: 'Wholesaler', tier: 'wholesaler' },
  distributor: { label: 'Distributor', tier: 'distributor' },
};

const B2B_ROLES = ['retailer', 'wholesaler', 'distributor'];
const BUYER_ROLES = ['customer', ...B2B_ROLES];

const PERMISSIONS = {
  'dashboard.view': 'View admin dashboard',
  'users.read': 'View users', 'users.write': 'Manage users',
  'partners.approve': 'Approve retailer/wholesaler/distributor applications',
  'products.read': 'View products (admin)', 'products.write': 'Manage products, categories',
  'pricing.write': 'Manage tier, zone and negotiated prices',
  'orders.read': 'View all orders', 'orders.write': 'Update orders',
  'payments.read': 'View payments', 'payments.write': 'Verify/refund payments',
  'inventory.read': 'View inventory', 'inventory.write': 'Adjust stock and batches',
  'jars.write': 'Manage jar ledger',
  'delivery.manage': 'Manage delivery staff, zones and assignments',
  'delivery.perform': 'Perform deliveries',
  'coupons.write': 'Manage coupons',
  'subscriptions.manage': 'Manage subscriptions',
  'support.manage': 'Handle tickets, returns, reviews',
  'reports.view': 'View and export reports',
  'cms.write': 'Manage banners and content',
  'notifications.send': 'Send notifications',
  'settings.write': 'Change system settings',
  'admins.manage': 'Manage admin users',
  'audit.read': 'View audit logs',
};

const ALL = Object.keys(PERMISSIONS);
const ROLE_PERMISSIONS = {
  super_admin: ALL,
  admin: ALL.filter((p) => !['admins.manage', 'settings.write'].includes(p)),
  delivery: ['delivery.perform'],
  customer: [], retailer: [], wholesaler: [], distributor: [],
};

const tierForRole = (role) => ROLES[role]?.tier || null;

module.exports = { ROLES, B2B_ROLES, BUYER_ROLES, PERMISSIONS, ROLE_PERMISSIONS, tierForRole };
