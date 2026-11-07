// Default channels per notification event; editable in Admin → Settings → notification_channels.
const DEFAULT_CHANNELS = {
  order_confirmed: ['in_app', 'sms', 'whatsapp', 'push'],
  payment_received: ['in_app', 'email', 'push'],
  order_dispatched: ['in_app', 'push'],
  out_for_delivery: ['in_app', 'sms', 'push'],
  delivered: ['in_app', 'push'],
  low_stock: ['in_app', 'email'],
  payment_due: ['in_app', 'sms', 'whatsapp'],
  subscription_reminder: ['in_app', 'push'],
  promotion: ['in_app', 'push'],
};

module.exports = { DEFAULT_CHANNELS };
