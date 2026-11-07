const db = require('../database/db');

async function log(req, action, entity, entityId, meta, trx = db) {
  await trx('audit_logs').insert({
    user_id: req?.user?.id || null,
    action,
    entity,
    entity_id: entityId != null ? String(entityId) : null,
    meta: meta ? JSON.stringify(meta) : null,
    ip: req?.ip || null,
  });
}

module.exports = { log };
