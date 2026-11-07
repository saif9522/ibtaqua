const router = require('express').Router();
const db = require('../../database/db');
const audit = require('../../services/audit.service');
const settings = require('../../services/settings.service');
const notify = require('../../services/notification.service');
const reports = require('../../services/report.service');
const { requirePerm } = require('../../middleware/auth');
const { validate } = require('../../middleware/common');
const { cmsUpload, verifyMagic, publicPath } = require('../../middleware/upload');
const { ah, notFound, bad } = require('../../utils/errors');
const { paginate, parseJSON, todayIST } = require('../../utils/helpers');
const v = require('../../validators');

router.get('/dashboard', requirePerm('dashboard.view'), ah(async (req, res) => res.json(await reports.dashboard())));

// ---------- Reports: /reports/:name?from&to&group&tier&format=json|xlsx|pdf ----------
router.get('/reports/:name', requirePerm('reports.view'), ah(async (req, res) => {
  const fn = reports.REPORTS[req.params.name];
  if (!fn) throw notFound('Report');
  const report = await fn({ from: req.query.from, to: req.query.to, group: req.query.group, tier: req.query.tier });
  const fname = `ibt-aqua-${req.params.name}-${todayIST()}`;
  if (req.query.format === 'xlsx') {
    res.setHeader('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.xlsx"`);
    return reports.exportXlsx(report, res).then(() => res.end());
  }
  if (req.query.format === 'pdf') {
    res.setHeader('Content-Type', 'application/pdf');
    res.setHeader('Content-Disposition', `attachment; filename="${fname}.pdf"`);
    return reports.exportPdf(report, res, `Period: ${req.query.from || 'start'} to ${req.query.to || 'today'} · Generated ${new Date().toISOString().slice(0, 16)} UTC`);
  }
  res.json(report);
}));

// ---------- Settings ----------
router.get('/settings', requirePerm('dashboard.view'), ah(async (req, res) => res.json(Object.values(await settings.all()))));
router.put('/settings', requirePerm('settings.write'), validate({ body: v.z.object({ values: v.z.record(v.z.string(), v.z.any()) }) }), ah(async (req, res) => {
  const known = await settings.all();
  await db.transaction(async (trx) => {
    for (const [k, val] of Object.entries(req.body.values)) {
      if (!known[k]) throw bad(`Unknown setting: ${k}`);
      await settings.set(k, val, trx);
    }
    await audit.log(req, 'settings.update', 'settings', null, { keys: Object.keys(req.body.values) }, trx);
  });
  settings.clear();
  res.json(Object.values(await settings.all()));
}));

// ---------- CMS ----------
const cms = v.z.object({ type: v.z.enum(['banner', 'page', 'faq', 'testimonial', 'section']), slug: v.z.string().trim().min(1).max(120), title: v.opt(v.z.string().max(200)), body: v.z.any().optional(), image: v.opt(v.z.string().max(255)), link: v.opt(v.z.string().max(255)), sortOrder: v.z.coerce.number().int().default(0), isActive: v.z.boolean().default(true) });
const cmsRow = (b) => ({ type: b.type, slug: b.slug, title: b.title || null, body: b.body === undefined ? null : typeof b.body === 'string' ? b.body : JSON.stringify(b.body), image: b.image || null, link: b.link || null, sort_order: b.sortOrder, is_active: b.isActive });
router.get('/cms', requirePerm('cms.write'), ah(async (req, res) => res.json((await db('cms_content').where((q) => (req.query.type ? q.where('type', String(req.query.type)) : q)).orderBy(['type', 'sort_order'])).map((r) => ({ ...r, body: parseJSON(r.body, r.body) })))));
router.post('/cms', requirePerm('cms.write'), validate({ body: cms }), ah(async (req, res) => {
  const [id] = await db('cms_content').insert(cmsRow(req.body));
  await audit.log(req, 'cms.create', 'cms', id);
  res.status(201).json(await db('cms_content').where({ id }).first());
}));
router.put('/cms/:id', requirePerm('cms.write'), validate({ body: cms }), ah(async (req, res) => {
  await db('cms_content').where({ id: req.params.id }).update({ ...cmsRow(req.body), updated_at: db.fn.now() });
  await audit.log(req, 'cms.update', 'cms', req.params.id);
  res.json(await db('cms_content').where({ id: req.params.id }).first());
}));
router.delete('/cms/:id', requirePerm('cms.write'), ah(async (req, res) => { await db('cms_content').where({ id: req.params.id }).del(); await audit.log(req, 'cms.delete', 'cms', req.params.id); res.json({ ok: true }); }));
router.post('/uploads/cms', requirePerm('cms.write'), cmsUpload.single('image'), verifyMagic, ah(async (req, res) => {
  if (!req.file) throw bad('Choose an image');
  res.status(201).json({ path: publicPath(req.file, 'cms') });
}));

// ---------- Notifications ----------
router.get('/notifications', requirePerm('dashboard.view'), ah(async (req, res) => {
  const rows = await db('notifications').where({ user_id: req.user.id }).orderBy('id', 'desc').limit(50);
  const unread = (await db('notifications').where({ user_id: req.user.id, is_read: false }).count({ n: '*' }).first()).n;
  res.json({ data: rows.map((r) => ({ ...r, data: parseJSON(r.data) })), unread });
}));
router.post('/notifications/read', requirePerm('dashboard.view'), ah(async (req, res) => { await db('notifications').where({ user_id: req.user.id }).update({ is_read: true }); res.json({ ok: true }); }));
router.post('/notifications/broadcast', requirePerm('notifications.send'), validate({ body: v.z.object({ roles: v.z.array(v.z.enum(['customer', 'retailer', 'wholesaler', 'distributor', 'delivery'])).min(1), title: v.z.string().trim().min(3).max(160), body: v.z.string().trim().max(1000), type: v.z.enum(['promotion', 'payment_due', 'subscription_reminder', 'announcement']).default('promotion') }) }), ah(async (req, res) => {
  await db.transaction(async (trx) => {
    await notify.broadcast(trx, req.body.roles, { type: req.body.type, title: req.body.title, body: req.body.body });
    await audit.log(req, 'notification.broadcast', 'notification', null, req.body, trx);
  });
  res.json({ ok: true });
}));
router.post('/notifications/payment-reminders', requirePerm('notifications.send'), ah(async (req, res) => {
  const due = await db('orders').where('payment_method', 'credit').whereNotIn('status', ['cancelled', 'returned']).andWhereRaw('amount_paid < grand_total').andWhere('due_date', '<=', todayIST())
    .select('user_id').sum({ due: db.raw('grand_total - amount_paid') }).groupBy('user_id');
  await db.transaction(async (trx) => { for (const d of due) await notify.toUser(trx, d.user_id, { type: 'payment_due', title: 'Payment due', body: `₹${d.due / 100} is due on your IBT AQUA account. Please clear it to keep ordering on credit.` }); });
  res.json({ sent: due.length });
}));
router.get('/notification-outbox', requirePerm('notifications.send'), ah(async (req, res) => res.json(await db('notification_outbox').orderBy('id', 'desc').limit(200))));

// ---------- Support, reviews, enquiries ----------
router.get('/tickets', requirePerm('support.manage'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('support_tickets as t').join('users as u', 'u.id', 't.user_id').leftJoin('orders as o', 'o.id', 't.order_id');
  if (req.query.status) q.where('t.status', String(req.query.status));
  if (req.query.category) q.andWhere('t.category', String(req.query.category));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  res.json({ data: await q.select('t.*', 'u.name', 'u.phone', 'o.order_number').orderBy('t.id', 'desc').limit(limit).offset(offset), page, limit, total });
}));
router.get('/tickets/:id', requirePerm('support.manage'), ah(async (req, res) => {
  const t = await db('support_tickets as t').join('users as u', 'u.id', 't.user_id').where('t.id', req.params.id).first('t.*', 'u.name', 'u.phone');
  if (!t) throw notFound('Ticket');
  t.messages = await db('ticket_messages as m').join('users as u', 'u.id', 'm.user_id').where('m.ticket_id', t.id).orderBy('m.id').select('m.*', 'u.name');
  res.json(t);
}));
router.post('/tickets/:id/reply', requirePerm('support.manage'), validate({ body: v.z.object({ message: v.z.string().trim().min(1).max(4000), status: v.z.enum(['open', 'in_progress', 'resolved', 'closed']).optional(), priority: v.z.enum(['low', 'normal', 'high']).optional() }) }), ah(async (req, res) => {
  const t = await db('support_tickets').where({ id: req.params.id }).first();
  if (!t) throw notFound('Ticket');
  await db.transaction(async (trx) => {
    await trx('ticket_messages').insert({ ticket_id: t.id, user_id: req.user.id, message: req.body.message, is_staff: true });
    await trx('support_tickets').where({ id: t.id }).update({ status: req.body.status || 'in_progress', ...(req.body.priority && { priority: req.body.priority }), updated_at: trx.fn.now() });
    await notify.toUser(trx, t.user_id, { type: 'ticket', title: `Reply on ${t.ticket_number}`, body: req.body.message.slice(0, 200), data: { ticketId: t.id } });
  });
  res.json({ ok: true });
}));
router.get('/reviews', requirePerm('support.manage'), ah(async (req, res) => res.json(await db('reviews as r').join('users as u', 'u.id', 'r.user_id').join('products as p', 'p.id', 'r.product_id')
  .where((q) => (req.query.status ? q.where('r.status', String(req.query.status)) : q)).orderBy('r.id', 'desc').limit(300).select('r.*', 'u.name', 'p.name as product_name'))));
router.patch('/reviews/:id', requirePerm('support.manage'), validate({ body: v.z.object({ status: v.z.enum(['approved', 'rejected', 'pending']) }) }), ah(async (req, res) => {
  await db('reviews').where({ id: req.params.id }).update({ status: req.body.status, updated_at: db.fn.now() });
  await audit.log(req, `review.${req.body.status}`, 'review', req.params.id);
  res.json({ ok: true });
}));
router.get('/enquiries', requirePerm('support.manage'), ah(async (req, res) => res.json((await db('enquiries').where((q) => (req.query.type ? q.where('type', String(req.query.type)) : q)).orderBy('id', 'desc').limit(300)).map((e) => ({ ...e, details: parseJSON(e.details) })))));
router.patch('/enquiries/:id', requirePerm('support.manage'), validate({ body: v.z.object({ status: v.z.enum(['new', 'contacted', 'closed']) }) }), ah(async (req, res) => { await db('enquiries').where({ id: req.params.id }).update({ status: req.body.status }); res.json({ ok: true }); }));

// ---------- Audit & backup ----------
router.get('/audit-logs', requirePerm('audit.read'), ah(async (req, res) => {
  const { page, limit, offset } = paginate(req.query);
  const q = db('audit_logs as a').leftJoin('users as u', 'u.id', 'a.user_id');
  if (req.query.entity) q.where('a.entity', String(req.query.entity));
  if (req.query.action) q.andWhere('a.action', 'like', `${req.query.action}%`);
  if (req.query.userId) q.andWhere('a.user_id', Number(req.query.userId));
  const total = (await q.clone().count({ n: '*' }).first()).n;
  res.json({ data: (await q.select('a.*', 'u.name as user_name').orderBy('a.id', 'desc').limit(limit).offset(offset)).map((r) => ({ ...r, meta: parseJSON(r.meta) })), page, limit, total });
}));
router.post('/backup', requirePerm('settings.write'), ah(async (req, res) => {
  const file = await require('../../utils/backup').run();
  await audit.log(req, 'system.backup', 'system', null, { file });
  res.json({ file });
}));

module.exports = router;
