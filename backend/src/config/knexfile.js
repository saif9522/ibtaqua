const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env'), quiet: true });

const root = path.resolve(__dirname, '../..');
const dbFile = process.env.DB_FILE
  ? path.resolve(root, process.env.DB_FILE)
  : path.join(root, 'data', process.env.NODE_ENV === 'test' ? 'test.sqlite' : 'ibt_aqua.sqlite');

// To move to PostgreSQL later: set client 'pg' and connection from DATABASE_URL.
// Migrations only use portable Knex schema builders, so they run unchanged.
module.exports = {
  client: 'better-sqlite3',
  connection: { filename: dbFile },
  useNullAsDefault: true,
  pool: {
    afterCreate: (conn, done) => {
      conn.pragma('foreign_keys = ON');
      conn.pragma('journal_mode = WAL');
      conn.pragma('busy_timeout = 5000');
      done();
    },
  },
  migrations: { directory: path.join(root, 'src/migrations'), tableName: 'knex_migrations' },
  seeds: { directory: path.join(root, 'src/database/seeds') },
};
