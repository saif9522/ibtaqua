import { api, errMsg } from '../services/api';

const loadScript = () => new Promise((resolve, reject) => {
  if (window.Razorpay) return resolve();
  const s = document.createElement('script');
  s.src = 'https://checkout.razorpay.com/v1/checkout.js';
  s.onload = resolve; s.onerror = () => reject(new Error('Could not load the payment window. Check your connection.'));
  document.body.appendChild(s);
});

/**
 * Starts an online payment for an order. Resolves with { status } once the SERVER has verified it.
 * Without Razorpay keys (development) the backend runs in mock mode and we simulate a successful payment.
 */
export async function payOnline(orderId, user) {
  const { data: rp } = await api.post('/account/payments/razorpay/order', { orderId });
  if (rp.mock) {
    if (!window.confirm(`Development mode: no Razorpay keys are configured.\n\nSimulate a successful payment of ₹${rp.amount / 100}?`)) throw new Error('Payment cancelled');
    const { data: sig } = await api.post('/account/payments/razorpay/dev-sign', { providerOrderId: rp.providerOrderId });
    return (await api.post('/account/payments/razorpay/verify', sig)).data;
  }
  await loadScript();
  return new Promise((resolve, reject) => {
    const rz = new window.Razorpay({
      key: rp.keyId, amount: rp.amount, currency: 'INR', order_id: rp.providerOrderId, name: 'IBT AQUA', description: `Order ${rp.orderNumber}`,
      prefill: { name: user?.name, contact: user?.phone, email: user?.email || undefined }, theme: { color: '#0596B4' },
      handler: async (resp) => {
        try { resolve((await api.post('/account/payments/razorpay/verify', resp)).data); } catch (e) { reject(new Error(errMsg(e))); }
      },
      modal: { ondismiss: () => reject(new Error('Payment window closed. Your order is saved; you can pay from My orders.')) },
    });
    rz.on('payment.failed', (r) => {
      api.post('/account/payments/razorpay/failed', { razorpay_order_id: rp.providerOrderId, reason: r.error?.description }).catch(() => {});
    });
    rz.open();
  });
}
