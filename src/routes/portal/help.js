'use strict';

const { perPageFor, pagerFor } = require('../../lib/pager');
const express = require('express');
const support = require('../../services/support');
const { audit } = require('../../services/audit');
const { can } = require('../../auth/permissions');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { helpSchema, replySchema } = require('../../validation/support');
const richText = require('../../lib/richText');

/** Cleaned HTML from a formatted editor field (`<name>_html`), or null. */
const editorHtml = (body, name) => {
  const raw = body[`${name}_html`];
  const html = typeof raw === 'string' && raw.length <= 50000 ? richText.clean(raw) : '';
  return html && richText.toText(html) ? html : null;
};

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];

const shared = { categories: support.CATEGORIES, statusLabels: support.STATUS_LABELS };

// --- List ------------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const team = can(req.user, 'support.view');
  const wanted = support.TABS[req.query.tab] ? req.query.tab : team ? 'open' : 'mine';
  const tab = support.TABS[wanted].support && !team ? 'mine' : wanted;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const perPage = await perPageFor(req);
  const result = await support.list(req.user, { tab, q, page: req.query.page, perPage });
  res.render('pages/portal/help/index.njk', {
    title: team ? 'Help requests' : 'My help requests',
    subheading: team ? 'Problems and questions from staff, sent with “Get help”.' : 'Problems and questions you’ve sent, and the replies.',
    crumbs,
    tab,
    q,
    team,
    tabs: Object.entries(support.TABS).filter(([, t]) => team || !t.support).map(([key, t]) => ({ key, label: t.label })),
    counts: await support.tabCounts(req.user),
    ...result,
    pager: pagerFor('/portal/help', { tab, q }, result, perPage),
    showSettings: can(req.user, 'support.settings'),
    developerEmail: support.developerEmail(),
    autoForward: await support.autoForward(),
    ...shared,
  });
});

/** Switch automatic forwarding of problem reports to the developer (DEVELOPER_EMAIL) on or off. */
router.post('/settings', async (req, res) => {
  if (!can(req.user, 'support.settings')) return res.status(403).render('pages/portal/error.njk', { title: 'Not allowed', status: 403, message: 'You can’t change this setting.' });
  const on = req.body.forward === 'on';
  await support.setAutoForward(on, req.user);
  await audit(req, { action: 'support.settings', entityType: 'setting', entityId: 'support.forward', summary: `${req.user.name} switched ${on ? 'on' : 'off'} forwarding problem reports to the developer` });
  setFlash(req, 'success', on ? 'Problem reports will be forwarded to the developer.' : 'Problem reports will stay in the portal. You can still forward one by hand.');
  res.redirect(303, '/portal/help#settings');
});

// --- Ask for help ----------------------------------------------------------------------------

async function renderForm(req, res, { values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/help/new.njk', {
    title: 'Get help',
    subheading: 'Tell us what’s wrong or what you need. IT and the Admin team are told straight away.',
    crumbs,
    values,
    errors,
    recent: await support.recentFor(req.user),
    ...shared,
  });
}

router.get('/new', (req, res) => {
  const { portalPath } = require('../../validation/support');
  const str = (v) => (typeof v === 'string' ? v : '');
  renderForm(req, res, {
    values: {
      category: support.CATEGORIES[req.query.category] ? req.query.category : '',
      from: portalPath(str(req.query.from)),
      error_ref: /^ERR-[2-9A-HJKMNP-Z]{6}$/.test(str(req.query.error)) ? req.query.error : '',
    },
  });
});

router.post('/', async (req, res) => {
  // From the formatted editor: cleaned HTML, and its plain text (for checks, search and emails).
  const html = editorHtml(req.body, 'message');
  const parsed = helpSchema.safeParse({ ...req.body, message: html ? richText.toText(html) : req.body.message });
  if (req.uploadError) return renderForm(req, res, { values: req.body, errors: { screenshot: req.uploadError, ...(parsed.success ? {} : fieldErrors(parsed.error)) }, status: 422 });
  if (!parsed.success) return renderForm(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  let result;
  try {
    result = await support.create(req.user, parsed.data, { file: req.file, userAgent: req.get('user-agent'), html });
  } catch (err) {
    if (err.status !== 422) throw err;
    const field = /screenshot|image/i.test(err.message) ? 'screenshot' : 'message';
    return renderForm(req, res, { values: req.body, errors: { [field]: err.message }, status: 422 });
  }
  const r = result.request;
  await audit(req, { action: 'support.request', entityType: 'support_request', entityId: r.id, summary: `${req.user.name} asked for help (${support.CATEGORIES[r.category].label}, ${r.reference})` });
  setFlash(req, 'success', `Sent (${r.reference}). ${result.told ? 'IT and the Admin team have been told' : 'Nobody else is set up to receive help requests yet, so please also tell the office'}; you’ll get a notification and an email when someone replies.`);
  res.redirect(303, `/portal/help/${r.id}`);
});

// --- One request -----------------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.help = /^\d+$/.test(id) ? await support.getFor(req.user, Number(id)) : null;
  if (!req.help) {
    const err = new Error('That help request doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

async function renderShow(req, res, { errors = {}, values = {}, status = 200 } = {}) {
  const r = req.help;
  const mine = r.user_id === req.user.id;
  res.status(status).render('pages/portal/help/show.njk', {
    title: mine ? 'Your help request' : `Help request from ${r.user_name}`,
    subheading: `${support.CATEGORIES[r.category].label} · ${r.reference}`,
    crumbs: [...crumbs, { label: can(req.user, 'support.view') ? 'Help requests' : 'My help requests', href: '/portal/help' }],
    r,
    mine,
    thread: await support.updates(r.id),
    mayUpdate: can(req.user, 'support.edit'),
    developerSet: Boolean(support.developerEmail()),
    errors,
    values,
    ...shared,
  });
}

router.get('/:id', (req, res) => renderShow(req, res));

router.get('/:id/screenshot', (req, res, next) => {
  const file = support.screenshotFile(req.help.screenshot);
  if (!file) return next();
  res.set('Cache-Control', 'private, no-store');
  res.sendFile(file, { headers: { 'Content-Type': 'image/webp', 'X-Content-Type-Options': 'nosniff', 'Content-Disposition': 'inline' } }, (err) => err && next());
});

router.post('/:id/reply', async (req, res) => {
  const r = req.help;
  if (r.user_id !== req.user.id && !can(req.user, 'support.edit')) {
    setFlash(req, 'error', 'You can’t reply to this request.');
    return res.redirect(303, `/portal/help/${r.id}`);
  }
  const html = editorHtml(req.body, 'body');
  const parsed = replySchema.safeParse({ ...req.body, body: html ? richText.toText(html) : req.body.body });
  if (!parsed.success) return renderShow(req, res, { errors: fieldErrors(parsed.error), values: req.body, status: 422 });
  const result = await support.reply(r, req.user, { ...parsed.data, html });
  if (!result.changed) {
    setFlash(req, 'error', 'Write a reply or choose a new status.');
    return res.redirect(303, `/portal/help/${r.id}`);
  }
  const statusChange = result.status !== r.status ? ` (${support.STATUS_LABELS[r.status]} → ${support.STATUS_LABELS[result.status]})` : '';
  await audit(req, { action: 'support.reply', entityType: 'support_request', entityId: r.id, summary: `${req.user.name} updated help request ${r.reference}${statusChange}` });
  setFlash(req, 'success', r.user_id === req.user.id
    ? (result.status === 'open' && r.status === 'fixed' ? 'Sent, and the request is open again.' : 'Sent.')
    : `Saved. ${r.user_name.split(' ')[0]} has been told by notification and email.`);
  res.redirect(303, `/portal/help/${r.id}`);
});

router.post('/:id/forward', async (req, res) => {
  const r = req.help;
  if (!can(req.user, 'support.edit')) {
    setFlash(req, 'error', 'You can’t forward help requests.');
    return res.redirect(303, `/portal/help/${r.id}`);
  }
  if (!support.developerEmail()) {
    setFlash(req, 'error', 'No developer email is set up yet (DEVELOPER_EMAIL in the server’s .env file).');
    return res.redirect(303, `/portal/help/${r.id}`);
  }
  const ok = await support.forward(r, req.user);
  if (ok) await audit(req, { action: 'support.forward', entityType: 'support_request', entityId: r.id, summary: `${req.user.name} forwarded help request ${r.reference} to the developer` });
  setFlash(req, ok ? 'success' : 'error', ok ? 'Forwarded to the developer.' : 'The email couldn’t be sent. Please try again later.');
  res.redirect(303, `/portal/help/${r.id}`);
});

module.exports = router;
