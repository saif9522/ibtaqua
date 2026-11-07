/**
 * In-process scheduler (no external cron needed on a single server).
 * For multiple instances, run jobs on one instance only (ENABLE_JOBS=false elsewhere).
 */
const subs = require('../services/subscription.service');
const inventory = require('../services/inventory.service');
const notify = require('../services/notification.service');
const backup = require('../utils/backup');
const { todayIST } = require('../utils/helpers');

let lastDaily = null;
const safe = (name, fn) => fn().catch((e) => console.error(`[job:${name}]`, e.message));

function start() {
  // Every 30s: flush outbound SMS/WhatsApp/email/push.
  setInterval(() => safe('outbox', () => notify.dispatchOutbox()), 30e3).unref();
  // Every 10 min: once per IST day, run the daily jobs.
  const daily = async () => {
    const today = todayIST();
    if (lastDaily === today) return;
    lastDaily = today;
    await safe('expire-batches', () => inventory.expireBatches());
    await safe('subscriptions', () => subs.generateDue(today));
    await safe('backup', () => backup.run());
  };
  setInterval(daily, 10 * 60e3).unref();
  setTimeout(daily, 5e3).unref();
}

module.exports = { start };
