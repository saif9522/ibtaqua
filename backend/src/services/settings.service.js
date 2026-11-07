const db = require('../database/db');
const { parseJSON } = require('../utils/helpers');

let cache = null;
async function all() {
  if (!cache) {
    const rows = await db('system_settings').select();
    cache = Object.fromEntries(rows.map((r) => [r.key, { ...r, value: parseJSON(r.value) }]));
  }
  return cache;
}
const clear = () => { cache = null; };

async function get(key, fallback = null) {
  const s = await all();
  return s[key] ? s[key].value : fallback;
}

async function getPublic() {
  const s = await all();
  return Object.fromEntries(Object.values(s).filter((r) => r.is_public).map((r) => [r.key, r.value]));
}

async function set(key, value, trx = db) {
  const existing = await trx('system_settings').where({ key }).first();
  if (existing) await trx('system_settings').where({ key }).update({ value: JSON.stringify(value), updated_at: trx.fn.now() });
  else await trx('system_settings').insert({ key, value: JSON.stringify(value) });
  clear();
}

module.exports = { all, get, getPublic, set, clear };
