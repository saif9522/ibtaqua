const env = require('./config/env');
const app = require('./app');
const db = require('./database/db');

async function main() {
  await db.migrate.latest();
  const server = app.listen(env.PORT, () => console.log(`IBT AQUA API on http://localhost:${env.PORT} (${env.NODE_ENV})`));
  if (env.ENABLE_JOBS === 'true') require('./jobs/scheduler').start();
  const shutdown = () => server.close(() => db.destroy().then(() => process.exit(0)));
  process.on('SIGTERM', shutdown);
  process.on('SIGINT', shutdown);
}

main().catch((e) => { console.error(e); process.exit(1); });
