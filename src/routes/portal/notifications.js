'use strict';

const express = require('express');
const notifications = require('../../services/notifications');
const { setFlash } = require('../../lib/forms');

const router = express.Router();

const wantsJson = (req) => req.get('accept') && req.get('accept').includes('application/json');

/** Only same-site portal/website paths are followed after marking read. */
const safeLink = (link) => (typeof link === 'string' && link.startsWith('/') && !link.startsWith('//') ? link : null);

// For the bell in the header (polled every minute while the tab is open).
router.get('/summary', async (req, res) => {
  const [unread, items] = await Promise.all([notifications.unreadCount(req.user.id), notifications.latest(req.user.id, 8)]);
  res.json({
    unread,
    items: items.map((n) => ({ id: n.id, title: n.title, body: n.body, link: safeLink(n.link), read: Boolean(n.read_at), at: n.created_at })),
  });
});

router.get('/', async (req, res) => {
  const result = await notifications.page(req.user.id, { page: req.query.page });
  res.render('pages/portal/notifications.njk', {
    title: 'Notifications',
    crumbs: [{ label: 'Dashboard', href: '/portal' }],
    ...result,
    unread: await notifications.unreadCount(req.user.id),
  });
});

router.post('/read-all', async (req, res) => {
  await notifications.markAllRead(req.user.id);
  if (wantsJson(req)) return res.json({ ok: true });
  setFlash(req, 'success', 'All notifications marked as read.');
  res.redirect(303, '/portal/notifications');
});

// Mark one read, then go to what it's about.
router.post('/:id/read', async (req, res) => {
  const row = /^\d+$/.test(req.params.id) ? await notifications.markRead(req.user.id, Number(req.params.id)) : null;
  if (wantsJson(req)) return res.json({ ok: Boolean(row) });
  res.redirect(303, (row && safeLink(row.link)) || '/portal/notifications');
});

module.exports = router;
