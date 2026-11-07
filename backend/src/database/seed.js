/**
 * npm run seed            → migrations + base seed + DEMO data (dev only, refuses in production)
 * npm run seed:prod       → migrations + base seed only (roles, permissions, settings, categories)
 */
const env = require('../config/env');
const db = require('./db');

(async () => {
  const baseOnly = process.argv.includes('--base-only');
  await db.migrate.latest();
  await db.seed.run(); // runs seeds/01_base.js
  console.log('Base data ready.');
  if (!baseOnly) {
    if (env.isProd) { console.error('Refusing to load demo data in production. Use npm run seed:prod.'); process.exit(1); }
    const already = await db('system_settings').where({ key: 'demo_data_loaded' }).first();
    if (already) console.log('Demo data already loaded (delete data/ibt_aqua.sqlite or run npm run db:reset to start fresh).');
    else { await require('./demo').load(); console.log('Demo data loaded. See docs/DEMO_ACCOUNTS.md'); }
  }
  await db.destroy();
})().catch(async (e) => { console.error(e); await db.destroy(); process.exit(1); });
