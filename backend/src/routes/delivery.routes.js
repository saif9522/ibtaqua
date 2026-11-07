const router = require('express').Router();
const delivery = require('../services/delivery.service');
const { requireAuth, requirePerm } = require('../middleware/auth');
const { validate } = require('../middleware/common');
const { ah } = require('../utils/errors');
const { todayIST } = require('../utils/helpers');
const v = require('../validators');

router.use(requireAuth(), requirePerm('delivery.perform'));

router.get('/run', ah(async (req, res) => res.json(await delivery.myRun(req.user, { status: req.query.status || 'active', date: req.query.date }))));
router.get('/report', ah(async (req, res) => {
  const staff = await delivery.staffForUser(require('../database/db'), req.user.id);
  res.json(await delivery.dailyReport(staff.id, req.query.date || todayIST()));
}));
router.post('/assignments/:id/pickup', ah(async (req, res) => { await delivery.pickUp(req.user, Number(req.params.id)); res.json({ ok: true }); }));
router.post('/assignments/:id/start', ah(async (req, res) => { await delivery.start(req.user, Number(req.params.id)); res.json({ ok: true }); }));
router.post('/assignments/:id/complete', validate({ body: v.z.object({
  otp: v.z.string().regex(/^\d{4}$/, 'Enter the 4-digit OTP'), cashCollected: v.paise.default(0), emptyJarsCollected: v.z.coerce.number().int().min(0).max(1000).default(0), notes: v.opt(v.z.string().max(300)),
}) }), ah(async (req, res) => { await delivery.complete(req.user, Number(req.params.id), req.body); res.json({ ok: true }); }));
router.post('/assignments/:id/fail', validate({ body: v.z.object({ reason: v.z.string().trim().min(3).max(300) }) }), ah(async (req, res) => { await delivery.fail(req.user, Number(req.params.id), req.body.reason); res.json({ ok: true }); }));
router.post('/availability', validate({ body: v.z.object({ available: v.z.boolean() }) }), ah(async (req, res) => {
  const db = require('../database/db');
  await db('delivery_staff').where({ user_id: req.user.id }).update({ is_available: req.body.available });
  res.json({ ok: true });
}));

module.exports = router;
