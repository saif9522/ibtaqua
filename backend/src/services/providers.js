/**
 * External message providers. Each is a thin adapter: plug real credentials into .env.
 * Without credentials they log to console (dev) and report `skipped` so nothing fails silently.
 */
const env = require('../config/env');

const log = (...a) => { if (!env.isTest) console.log('[notify]', ...a); };

async function postJSON(url, body, headers) {
  const res = await fetch(url, { method: 'POST', headers: { 'Content-Type': 'application/json', ...headers }, body: JSON.stringify(body) });
  if (!res.ok) throw new Error(`${url} → ${res.status} ${await res.text().catch(() => '')}`);
  return res.json().catch(() => ({}));
}

const sms = async (phone, text) => {
  if (env.SMS_PROVIDER === 'msg91' && env.SMS_API_KEY) {
    // MSG91 Flow API; configure a template whose single variable is the message body.
    return postJSON('https://control.msg91.com/api/v5/flow/', { recipients: [{ mobiles: `91${phone}`, message: text }] }, { authkey: env.SMS_API_KEY });
  }
  log(`SMS → ${phone}: ${text}`); return { skipped: true };
};

const whatsapp = async (phone, text) => {
  if (env.WHATSAPP_TOKEN && env.WHATSAPP_PHONE_ID) {
    return postJSON(`https://graph.facebook.com/v20.0/${env.WHATSAPP_PHONE_ID}/messages`,
      { messaging_product: 'whatsapp', to: `91${phone}`, type: 'text', text: { body: text } },
      { Authorization: `Bearer ${env.WHATSAPP_TOKEN}` });
  }
  log(`WhatsApp → ${phone}: ${text}`); return { skipped: true };
};

const email = async (to, subject, text) => {
  if (env.SMTP_URL) {
    // Wire nodemailer here (npm i nodemailer): createTransport(env.SMTP_URL).sendMail({ to, subject, text })
    log('SMTP configured but nodemailer adapter not installed'); return { skipped: true };
  }
  log(`Email → ${to}: ${subject}`); return { skipped: true };
};

const push = async (token, payload) => {
  if (env.FCM_SERVER_KEY) {
    // For FCM HTTP v1 use a service account; legacy key shown for simplicity.
    return postJSON('https://fcm.googleapis.com/fcm/send', { to: token, notification: { title: payload.title, body: payload.body }, data: payload.data || {} }, { Authorization: `key=${env.FCM_SERVER_KEY}` });
  }
  log(`Push → ${token.slice(0, 12)}…: ${payload.title}`); return { skipped: true };
};

async function send(channel, recipient, payload) {
  const text = payload.body ? `${payload.title}\n${payload.body}` : payload.title;
  if (channel === 'sms') return sms(recipient, text);
  if (channel === 'whatsapp') return whatsapp(recipient, text);
  if (channel === 'email') return email(recipient, payload.title, payload.body || '');
  if (channel === 'push') return push(recipient, payload);
  return { skipped: true };
}

module.exports = { send, sms };
