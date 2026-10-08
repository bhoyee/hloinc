'use strict';

const express = require('express');
const ann = require('../../services/announcements');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { marylandParts } = require('../../lib/hours');
const { announcementSchema, toRow } = require('../../validation/announcements');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const annCrumbs = [...crumbs, { label: 'Announcements', href: '/portal/announcements' }];
const can = requirePermission;

const hhmm = (parts) => parts.time;

/** Form values from a saved announcement, in Maryland time. */
function valuesOf(a) {
  const start = marylandParts(new Date(a.starts_at));
  const end = a.ends_at ? marylandParts(new Date(a.ends_at)) : null;
  return {
    title: a.title,
    body: a.body,
    audience: a.audience,
    start_date: start.date,
    start_time: hhmm(start),
    end_date: end ? end.date : '',
    end_time: end ? hhmm(end) : '',
    link_url: a.link_url || '',
    link_label: a.link_label || '',
  };
}

/** Tell staff about an internal announcement that's live now. */
async function announceToStaff(req, a) {
  if (a.state !== 'live' || a.audience === 'public') return;
  await notifications.notifyAllStaff(
    { type: 'announcement', title: a.title, body: a.body.slice(0, 200), link: '/portal#staff-board' },
    { exceptId: req.user.id }
  );
}

// --- List -------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const tab = ann.TABS[req.query.tab] ? req.query.tab : 'live';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const result = await ann.list({ tab, q, page: req.query.page });
  const pageUrl = (p) => `/portal/announcements?${new URLSearchParams(Object.entries({ tab, q, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;
  res.render('pages/portal/announcements/index.njk', {
    title: 'Announcements',
    subheading: 'News for the website, the staff board, or both. They start and end on their own.',
    crumbs,
    tab,
    q,
    tabs: Object.entries(ann.TABS).map(([key, t]) => ({ key, label: t.label })),
    counts: await ann.tabCounts(),
    ...result,
    audienceLabels: ann.AUDIENCE_LABELS,
    stateLabels: ann.STATE_LABELS,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
  });
});

// --- Create / edit ----------------------------------------------------------------------

function renderForm(res, { a = null, values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/announcements/form.njk', {
    title: a ? a.title : 'New announcement',
    subheading: a ? `${ann.STATE_LABELS[a.state]} · ${ann.AUDIENCE_LABELS[a.audience]}` : 'Choose who sees it and for how long.',
    crumbs: annCrumbs,
    a,
    values,
    errors,
    audienceLabels: ann.AUDIENCE_LABELS,
    stateLabels: ann.STATE_LABELS,
  });
}

router.get('/new', can('announcements.edit'), (req, res) => {
  const now = marylandParts(new Date());
  renderForm(res, { values: { audience: 'public', start_date: now.date, start_time: now.time, link_label: 'Learn more' } });
});

router.post('/', can('announcements.edit'), async (req, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const a = await ann.create(toRow(parsed.data), req.user);
  await audit(req, { action: 'announcement.create', entityType: 'announcement', entityId: a.id, summary: `${req.user.name} posted the announcement “${a.title}” (${ann.AUDIENCE_LABELS[a.audience].toLowerCase()})` });
  await announceToStaff(req, a);
  setFlash(req, 'success', a.state === 'live' ? 'Announcement posted. It’s live now.' : 'Announcement scheduled.');
  res.redirect(303, `/portal/announcements/${a.id}`);
});

router.param('id', async (req, res, next, id) => {
  req.ann = /^\d+$/.test(id) ? await ann.get(Number(id)) : null;
  if (!req.ann) {
    const err = new Error('That announcement doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

router.get('/:id', (req, res) => renderForm(res, { a: req.ann, values: valuesOf(req.ann) }));

router.post('/:id', can('announcements.edit'), async (req, res) => {
  const parsed = announcementSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(res, { a: req.ann, values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const a = await ann.update(req.ann.id, toRow(parsed.data), req.user);
  await audit(req, { action: 'announcement.update', entityType: 'announcement', entityId: a.id, summary: `${req.user.name} updated the announcement “${a.title}”` });
  setFlash(req, 'success', `Saved. ${a.state === 'live' ? 'It’s live now.' : `It’s ${ann.STATE_LABELS[a.state].toLowerCase()}.`}`);
  res.redirect(303, `/portal/announcements/${a.id}`);
});

router.post('/:id/end', can('announcements.edit'), async (req, res) => {
  if (req.ann.state !== 'live') {
    setFlash(req, 'error', 'Only a live announcement can be ended.');
  } else {
    await ann.endNow(req.ann.id, req.user);
    await audit(req, { action: 'announcement.end', entityType: 'announcement', entityId: req.ann.id, summary: `${req.user.name} ended the announcement “${req.ann.title}”` });
    setFlash(req, 'success', 'Ended. It’s no longer shown anywhere.');
  }
  res.redirect(303, `/portal/announcements/${req.ann.id}`);
});

router.post('/:id/archive', can('announcements.archive'), async (req, res) => {
  const archive = req.body.action !== 'restore';
  await ann.setArchived(req.ann.id, archive, req.user);
  await audit(req, { action: archive ? 'announcement.archive' : 'announcement.restore', entityType: 'announcement', entityId: req.ann.id, summary: `${req.user.name} ${archive ? 'archived' : 'restored'} the announcement “${req.ann.title}”` });
  setFlash(req, 'success', archive ? 'Archived. It’s hidden everywhere; you can restore it at any time.' : 'Restored.');
  res.redirect(303, `/portal/announcements/${req.ann.id}`);
});

router.post('/:id/delete', can('announcements.delete'), async (req, res) => {
  if (req.ann.state !== 'archived') {
    setFlash(req, 'error', 'Archive the announcement first. Only archived announcements can be deleted permanently.');
    return res.redirect(303, `/portal/announcements/${req.ann.id}`);
  }
  await ann.remove(req.ann.id);
  await audit(req, { action: 'announcement.delete', entityType: 'announcement', entityId: req.ann.id, summary: `${req.user.name} permanently deleted the announcement “${req.ann.title}”` });
  setFlash(req, 'success', `“${req.ann.title}” deleted permanently.`);
  res.redirect(303, '/portal/announcements?tab=archived');
});

module.exports = router;
