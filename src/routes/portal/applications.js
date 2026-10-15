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
    keepDays: require('../../config').virusScan.resumeKeepDays,
    expiresAt: applications.resumeExpiresAt(a),
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

/**
 * Preview the resume inside the portal (shown in a pop-up on the application page).
 * Only once its virus scan has passed; uploads with scripts, macros or embedded files are
 * refused when they arrive. A PDF opens in the browser's own viewer. A Word file is turned
 * into plain formatted text (mammoth), cleaned, and shown with scripts blocked.
 */
router.get('/:id/resume/preview', async (req, res) => {
  const a = req.application;
  const file = await applications.resume(a);
  const base = { 'X-Content-Type-Options': 'nosniff', 'Cache-Control': 'no-store' };
  if (!file) {
    res.set({ ...base, 'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; frame-ancestors 'self'" });
    return res.status(404).type('html').send('<p style="font:16px system-ui;padding:24px">This resume isn’t available to preview.</p>');
  }
  await audit(req, { action: 'application.resume_view', entityType: 'application', entityId: a.id, summary: `${req.user.name} previewed the resume for application ${ref(a)} (${a.first_name} ${a.last_name})` });
  if (a.resume_type === 'pdf') {
    // No "sandbox" here: browsers won't run their PDF viewer in a sandboxed frame.
    res.set({
      ...base,
      'Content-Type': 'application/pdf',
      'Content-Disposition': `inline; filename="${a.resume_name.replace(/["\\\r\n]/g, '')}"`,
      'Content-Length': file.length,
      'Content-Security-Policy': "frame-ancestors 'self'",
    });
    return res.send(file);
  }
  let body;
  try {
    const { value } = await require('mammoth').convertToHtml({ buffer: file });
    body = require('sanitize-html')(value, {
      allowedTags: ['h1', 'h2', 'h3', 'h4', 'h5', 'h6', 'p', 'br', 'strong', 'b', 'em', 'i', 'u', 's', 'ul', 'ol', 'li', 'table', 'thead', 'tbody', 'tr', 'th', 'td', 'blockquote', 'img', 'sup', 'sub'],
      allowedAttributes: { img: ['src', 'alt'], td: ['colspan', 'rowspan'], th: ['colspan', 'rowspan'] },
      allowedSchemes: [],
      allowedSchemesByTag: { img: ['data'] },
    });
  } catch {
    body = '';
  }
  if (!body.trim()) body = '<p class="empty">This Word file has no text we can show. Download it to open it in Word.</p>';
  res.set({ ...base, 'Content-Security-Policy': "sandbox; default-src 'none'; style-src 'unsafe-inline'; img-src data:; frame-ancestors 'self'" });
  res.type('html').send(`<!doctype html><html lang="en"><head><meta charset="utf-8"><title>Resume preview</title><style>
    body{margin:0;background:#eef2ef;font:16px/1.6 system-ui,-apple-system,"Segoe UI",sans-serif;color:#0f1c16}
    main{max-width:50rem;margin:24px auto;padding:48px 56px;background:#fff;box-shadow:0 4px 24px rgba(8,30,20,.12);border-radius:6px}
    h1,h2,h3,h4{line-height:1.25;margin:1.2em 0 .4em}h1:first-child,h2:first-child,p:first-child{margin-top:0}
    p{margin:0 0 .8em}ul,ol{margin:0 0 .8em;padding-left:1.4em}table{border-collapse:collapse;margin:0 0 1em}td,th{border:1px solid #dfe8e3;padding:4px 8px;vertical-align:top}
    img{max-width:100%;height:auto}.note{max-width:50rem;margin:16px auto 0;padding:0 8px;font-size:13px;color:#475950}.empty{color:#475950}
    @media (max-width:640px){main{margin:0;padding:24px;border-radius:0}}
  </style></head><body><p class="note">Preview of a Word document: the text and basic formatting. Download it to see the exact layout.</p><main>${body}</main></body></html>`);
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
