'use strict';

const { perPageFor, pagerFor } = require('../../lib/pager');
const express = require('express');
const timeOff = require('../../services/timeOff');
const { audit } = require('../../services/audit');
const { can } = require('../../auth/permissions');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { marylandParts } = require('../../lib/hours');
const { timeOffSchema, decisionSchema, MAX_DAYS } = require('../../validation/timeOff');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }, { label: 'Schedule', href: '/portal/schedule' }];
const toCrumbs = [...crumbs, { label: 'Time off', href: '/portal/schedule/time-off' }];

// --- List ---------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const manager = can(req.user, timeOff.APPROVE);
  const wanted = timeOff.TABS[req.query.tab] ? req.query.tab : manager ? 'pending' : 'mine';
  const tab = timeOff.TABS[wanted].manager && !manager ? 'mine' : wanted;
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const perPage = await perPageFor(req);
  const result = await timeOff.list(req.user, { tab, q, page: req.query.page, perPage });
  res.render('pages/portal/schedule/time-off/index.njk', {
    title: 'Time off',
    subheading: manager ? 'Requests from staff, and your own.' : 'Ask for time off and see your requests.',
    crumbs,
    tab,
    q,
    manager,
    tabs: Object.entries(timeOff.TABS).filter(([, t]) => manager || !t.manager).map(([key, t]) => ({ key, label: t.label })),
    counts: await timeOff.tabCounts(req.user),
    ...result,
    pager: pagerFor('/portal/schedule/time-off', { tab, q }, result, perPage),
    reasons: timeOff.REASONS,
    statusLabels: timeOff.STATUS_LABELS,
  });
});

// --- Ask for time off -----------------------------------------------------------------------

function renderForm(req, res, { values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/schedule/time-off/form.njk', {
    title: 'Request time off',
    subheading: 'Your manager is told straight away and you’ll hear back here and by email.',
    crumbs: toCrumbs,
    values,
    errors,
    reasons: timeOff.REASONS,
    maxDays: MAX_DAYS,
    today: marylandParts(new Date()).date,
  });
}

router.get('/new', (req, res) => {
  const today = marylandParts(new Date()).date;
  renderForm(req, res, { values: { reason: 'vacation', start_date: today, end_date: today, all_day: 'yes', start_time: '09:00', end_time: '13:00' } });
});

router.post('/', async (req, res) => {
  const parsed = timeOffSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const { request, told } = await timeOff.create(req.user, parsed.data);
  await audit(req, { action: 'timeoff.request', entityType: 'time_off', entityId: request.id, summary: `${req.user.name} asked for time off (${timeOff.REASONS[request.reason].toLowerCase()}, ${request.when})` });
  setFlash(req, 'success', told
    ? `Request sent. ${told === 1 ? 'Your manager has' : `${told} managers have`} been told by notification and email.`
    : 'Request saved. Nobody is set up to receive time-off requests yet, so please let the office know.');
  res.redirect(303, `/portal/schedule/time-off/${request.id}`);
});

// --- One request ------------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.request = /^\d+$/.test(id) ? await timeOff.getFor(req.user, Number(id)) : null;
  if (!req.request) {
    const err = new Error('That request doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

async function renderShow(req, res, { errors = {}, values = {}, status = 200 } = {}) {
  const r = req.request;
  const mayDecide = r.status === 'pending' && (await timeOff.canDecide(req.user, r.user_id));
  res.status(status).render('pages/portal/schedule/time-off/show.njk', {
    title: r.user_id === req.user.id ? 'Your time-off request' : `Time off for ${r.user_name}`,
    subheading: `${timeOff.REASONS[r.reason]} · ${r.when}`,
    crumbs: toCrumbs,
    r,
    mine: r.user_id === req.user.id,
    startDay: marylandParts(r.start_at).date,
    mayDecide,
    clashes: mayDecide ? (await timeOff.clashes(r)).map((s) => ({ ...s, when: timeOff.describe({ ...s, all_day: false }) })) : [],
    reasons: timeOff.REASONS,
    statusLabels: timeOff.STATUS_LABELS,
    errors,
    values,
  });
}

router.get('/:id', (req, res) => renderShow(req, res));

const back = (req, res) => res.redirect(303, `/portal/schedule/time-off/${req.request.id}`);

for (const action of ['approve', 'decline']) {
  router.post(`/:id/${action}`, async (req, res) => {
    const r = req.request;
    if (r.status !== 'pending' || !(await timeOff.canDecide(req.user, r.user_id))) {
      setFlash(req, 'error', r.status !== 'pending' ? 'This request has already been dealt with.' : 'You can’t decide on this request.');
      return back(req, res);
    }
    const parsed = decisionSchema.safeParse(req.body);
    if (!parsed.success) return renderShow(req, res, { errors: fieldErrors(parsed.error), values: req.body, status: 422 });
    await timeOff[action](r, req.user, parsed.data.note);
    await audit(req, { action: `timeoff.${action}`, entityType: 'time_off', entityId: r.id, summary: `${req.user.name} ${action === 'approve' ? 'approved' : 'declined'} time off for ${r.user_name} (${r.when})` });
    setFlash(req, 'success', action === 'approve'
      ? `Approved. It’s on ${r.user_name}’s schedule, and they’ve been told by notification and email.`
      : `Declined. ${r.user_name} has been told by notification and email.`);
    back(req, res);
  });
}

router.post('/:id/cancel', async (req, res) => {
  const r = req.request;
  if (r.user_id !== req.user.id || r.status !== 'pending') {
    setFlash(req, 'error', 'Only a pending request of your own can be cancelled.');
    return back(req, res);
  }
  await timeOff.cancel(r);
  await audit(req, { action: 'timeoff.cancel', entityType: 'time_off', entityId: r.id, summary: `${req.user.name} cancelled their time-off request (${r.when})` });
  setFlash(req, 'success', 'Request cancelled.');
  back(req, res);
});

module.exports = router;
