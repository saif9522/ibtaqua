/** Online SQLite backup (safe while the app is running). `npm run backup` or POST /api/admin/backup. */
const fs = require('fs');
const path = require('path');
const env = require('../config/env');
const db = require('../database/db');

async function run(keep = 14) {
  const dir = path.resolve(__dirname, '../..', env.BACKUP_DIR);
  fs.mkdirSync(dir, { recursive: true });
  const file = path.join(dir, `ibt_aqua-${new Date().toISOString().replace(/[:.]/g, '-')}.sqlite`);
  const conn = await db.client.acquireConnection();
  try { await conn.backup(file); } finally { await db.client.releaseConnection(conn); }
  const old = fs.readdirSync(dir).filter((f) => f.endsWith('.sqlite')).sort().reverse().slice(keep);
  old.forEach((f) => fs.rmSync(path.join(dir, f)));
  return path.basename(file);
}

module.exports = { run };

if (require.main === module) run().then((f) => { console.log(`Backup written: ${f}`); return db.destroy(); }).catch((e) => { console.error(e); process.exit(1); });
