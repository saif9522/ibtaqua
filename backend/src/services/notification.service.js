/**
 * Notifications: always stored in-app; external channels are queued in
 * notification_outbox and delivered by the dispatcher job through providers.js.
 * Channel toggles per event type live in setting `notification_channels`.
 */
const db = require('../database/db');
const settings = require('./settings.service');
const providers = require('./providers');

const { DEFAULT_CHANNELS } = require('../config/notifications');

async function channelsFor(type) {
  const cfg = await settings.get('notification_channels', DEFAULT_CHANNELS);
  return cfg[type] || ['in_app'];
}

async function toUser(trx, userId, { type, title, body, data }) {
  const channels = await channelsFor(type);
  const [id] = await trx('notifications').insert({ user_id: userId, type, title, body, data: data ? JSON.stringify(data) : null, channels: JSON.stringify(channels) });
  const user = await trx('users').where({ id: userId }).first('phone', 'email');
  const out = [];
  for (const ch of channels) {
    if (ch === 'in_app') continue;
    if (ch === 'email' && !user?.email) continue;
    if (ch === 'push') {
      const tokens = await trx('device_tokens').where({ user_id: userId }).pluck('token');
      tokens.forEach((tk) => out.push({ notification_id: id, channel: 'push', recipient: tk, payload: JSON.stringify({ title, body, data }) }));
      continue;
    }
    out.push({ notification_id: id, channel: ch, recipient: ch === 'email' ? user.email : user.phone, payload: JSON.stringify({ title, body }) });
  }
  if (out.length) await trx('notification_outbox').insert(out);
  return id;
}

async function toRole(trx, roleName, n) {
  const ids = await trx('users as u').join('roles as r', 'r.id', 'u.role_id').where('r.name', roleName).andWhere('u.status', 'active').pluck('u.id');
  for (const id of ids) await toUser(trx, id, n);
}

/** Broadcast (promotions): one in-app row per user in the audience, push queued. */
async function broadcast(trx, roleNames, n) {
  for (const r of roleNames) await toRole(trx, r, n);
}

/** Dispatcher job: sends queued external messages, retries up to 3 times. */
async function dispatchOutbox(limit = 50) {
  const rows = await db('notification_outbox').where('status', 'queued').andWhere('attempts', '<', 3).orderBy('id').limit(limit);
  for (const r of rows) {
    try {
      const payload = JSON.parse(r.payload);
      const res = await providers.send(r.channel, r.recipient, payload);
      await db('notification_outbox').where({ id: r.id }).update({ status: res.skipped ? 'skipped' : 'sent', attempts: r.attempts + 1, updated_at: db.fn.now() });
    } catch (e) {
      await db('notification_outbox').where({ id: r.id }).update({ attempts: r.attempts + 1, error: String(e.message).slice(0, 300), status: r.attempts + 1 >= 3 ? 'failed' : 'queued' });
    }
  }
  return rows.length;
}

module.exports = { toUser, toRole, broadcast, dispatchOutbox, DEFAULT_CHANNELS };
