'use strict';

const express = require('express');
const applications = require('../../services/applications');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { perPageFor, pagerFor } = require('../../lib/pager');
const { setFlash } = require('../../lib/forms');
const { of: ref } = require('../../lib/reference');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }, { label: 'Jobs', href: '/portal/jobs' }];

// --- List -----------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const tab = applications.TABS[req.query.tab] ? req.query.tab : 'new';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const job = /^\d+$/.test(String(req.query.job || '')) ? String(req.query.job) : '';
  const perPage = await perPageFor(req);
  const result = await applications.list({ tab, q, job, page: req.query.page, perPage });
  res.render('pages/portal/applications/index.njk', {
    title: 'Job applications',
    subheading: 'Applications from the careers page. Resumes open only after they pass the virus scan.',
    crumbs,
    tab,
    q,
    job,
    tabs: Object.entries(applications.TABS).map(([key, t]) => ({ key, label: t.label })),
    counts: await applications.tabCounts({ q, job }),
    jobs: await applications.jobsWithApplications(),
    ...result,
    statusLabels: applications.STATUS_LABELS,
    types: applications.TYPES,
    scanner: await require('../../services/virusScan').describe(),
    pager: pagerFor('/portal/applications', { tab, q, job }, result, perPage),
  });
});

// --- One application -----------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.application = /^\d+$/.test(id) ? await applications.get(Number(id)) : null;
  if (!req.application) {
    const err = new Error('That application doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

const back = (req, res) => res.redirect(303, `/portal/applications/${req.application.id}`);

router.get('/:id', async (req, res) => {
  const a = req.application;
  if (a.status === 'new') {
    await applications.setStatus(a, 'reviewing');
    a.status = 'reviewing';
  }
  res.render('pages/portal/applications/show.njk', {
    title: `${a.first_name} ${a.last_name}`,
    subheading: `Applied for ${a.job_title} · ${ref(a)}`,
    crumbs: [...crumbs, { label: 'Applications', href: '/portal/applications' }],
    a,
    statusLabels: applications.STATUS_LABELS,
    types: applications.TYPES,
  });
});

// The resume: only once its virus scan has passed, always as a download (never shown in the browser).
router.get('/:id/resume', async (req, res) => {
  const a = req.application;
  const file = await applications.resume(a);
  if (!file) {
    setFlash(req, 'error', a.scan_status === 'pending' ? 'This resume is still waiting for its virus scan, so it can’t be opened yet.' : 'This resume isn’t available.');
    return back(req, res);
  }
  await audit(req, { action: 'application.resume_download', entityType: 'application', entityId: a.id, summary: `${req.user.name} downloaded the resume for application ${ref(a)} (${a.first_name} ${a.last_name})` });
  res.set({
    'Content-Type': applications.TYPES[a.resume_type].mime,
    'Content-Disposition': `attachment; filename="${a.resume_name.replace(/["\\\r\n]/g, '')}"`,
    'Content-Length': file.length,
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "sandbox; default-src 'none'",
    'Cache-Control': 'no-store',
  });
  res.send(file);
});

router.post('/:id/status', async (req, res) => {
  const a = req.application;
  const status = Object.hasOwn(applications.STATUS_LABELS, req.body.status) ? req.body.status : null;
  if (status && status !== a.status) {
    await applications.setStatus(a, status);
    await audit(req, { action: 'application.status', entityType: 'application', entityId: a.id, summary: `${req.user.name} marked application ${ref(a)} as ${applications.STATUS_LABELS[status].toLowerCase()}` });
    setFlash(req, 'success', `Marked as ${applications.STATUS_LABELS[status].toLowerCase()}.`);
  }
  back(req, res);
});

router.post('/:id/delete', requirePermission('jobs.delete'), async (req, res) => {
  const a = req.application;
  await applications.remove(a);
  await audit(req, { action: 'application.delete', entityType: 'application', entityId: a.id, summary: `${req.user.name} deleted application ${ref(a)} (${a.first_name} ${a.last_name}, ${a.job_title}) and its resume` });
  setFlash(req, 'success', 'Application and resume deleted.');
  res.redirect(303, '/portal/applications');
});

module.exports = router;
