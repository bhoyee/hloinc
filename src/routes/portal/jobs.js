'use strict';

const { perPageFor, pagerFor } = require('../../lib/pager');

const express = require('express');
const jobs = require('../../services/jobs');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { can: userCan } = require('../../auth/permissions');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { jobSchema } = require('../../validation/jobs');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const jobCrumbs = [...crumbs, { label: 'Jobs', href: '/portal/jobs' }];
const can = requirePermission;

const FIELDS = ['title', 'department', 'location', 'employment_type', 'pay_range', 'description', 'requirements', 'benefits'];

// --- List -------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const tab = jobs.TABS[req.query.tab] ? req.query.tab : 'published';
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  const perPage = await perPageFor(req);
  const result = await jobs.portalList({ tab, q, page: req.query.page, perPage });
  const pageUrl = (p) => `/portal/jobs?${new URLSearchParams(Object.entries({ tab, q, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;
  res.render('pages/portal/jobs/index.njk', {
    title: 'Jobs',
    subheading: 'Positions on the careers page. People apply on each job’s page with their resume.',
    crumbs,
    tab,
    q,
    tabs: Object.entries(jobs.TABS).map(([key, t]) => ({ key, label: t.label })),
    counts: await jobs.tabCounts(),
    ...result,
    applicationCounts: userCan(req.user, 'jobs.applications') ? await require('../../services/applications').countsByJob(result.items.map((j) => j.id)) : null,
    statusLabels: jobs.STATUS_LABELS,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
    pager: pagerFor('/portal/jobs', { tab, q }, result, perPage),
  });
});

// --- Create -----------------------------------------------------------------------------

function renderForm(req, res, { job = null, values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/jobs/form.njk', {
    title: job ? job.title : 'New job',
    subheading: job ? `${jobs.STATUS_LABELS[job.status]}${job.published_at && job.status === 'published' ? ` · live since ${new Date(job.published_at).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}` : ''}` : 'Fill in the details, then save as a draft or publish it straight away.',
    crumbs: jobCrumbs,
    job,
    values,
    errors,
    statusLabels: jobs.STATUS_LABELS,
    employmentTypes: jobs.EMPLOYMENT_TYPE_OPTIONS,
  });
}

router.get('/new', can('jobs.edit'), (req, res) => renderForm(req, res, { values: { employment_type: 'Full-time' } }));

router.post('/', can('jobs.edit'), async (req, res) => {
  const publish = req.body.intent === 'publish';
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const problems = publish ? jobs.publishProblems(parsed.data) : {};
  if (Object.keys(problems).length) return renderForm(req, res, { values: req.body, errors: problems, status: 422 });

  const job = await jobs.create(parsed.data, req.user, { publish });
  await audit(req, {
    action: publish ? 'job.publish' : 'job.create',
    entityType: 'job',
    entityId: job.id,
    summary: `${req.user.name} ${publish ? 'published' : 'drafted'} the job “${job.title}”`,
  });
  setFlash(req, 'success', publish ? `“${job.title}” is now live on the careers page.` : `“${job.title}” saved as a draft.`);
  res.redirect(303, `/portal/jobs/${job.id}`);
});

// --- One job ----------------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.job = /^\d+$/.test(id) ? await jobs.get(Number(id)) : null;
  if (!req.job) {
    const err = new Error('That job doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

router.get('/:id', (req, res) => renderForm(req, res, { job: req.job, values: Object.fromEntries(FIELDS.map((f) => [f, req.job[f] ?? ''])) }));

/** The job as visitors will see it, including drafts (never indexed: the portal is noindex). */
router.get('/:id/preview', (req, res) => {
  res.render('pages/public/job.njk', {
    title: `Preview: ${req.job.title}`,
    job: req.job,
    preview: { status: jobs.STATUS_LABELS[req.job.status], back: `/portal/jobs/${req.job.id}` },
  });
});

router.post('/:id', can('jobs.edit'), async (req, res) => {
  const job = req.job;
  const parsed = jobSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(req, res, { job, values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  // A live posting must keep its pay range and benefits.
  const problems = job.status === 'published' || req.body.intent === 'publish' ? jobs.publishProblems(parsed.data) : {};
  if (Object.keys(problems).length) return renderForm(req, res, { job, values: req.body, errors: problems, status: 422 });

  let updated = await jobs.update(job, parsed.data, req.user);
  const publishing = req.body.intent === 'publish' && job.status !== 'published';
  if (publishing) updated = await jobs.move(updated, 'publish', req.user);
  await audit(req, {
    action: publishing ? 'job.publish' : 'job.update',
    entityType: 'job',
    entityId: job.id,
    summary: `${req.user.name} ${publishing ? 'updated and published' : 'updated'} the job “${updated.title}”`,
  });
  setFlash(req, 'success', publishing ? `“${updated.title}” is now live on the careers page.` : job.status === 'published' ? 'Saved. The careers page shows the changes now.' : 'Saved.');
  res.redirect(303, `/portal/jobs/${job.id}`);
});

const MOVE_PERMISSION = { publish: 'jobs.edit', unpublish: 'jobs.edit', archive: 'jobs.archive', restore: 'jobs.archive' };
const MOVE_TEXT = {
  publish: ['published', 'is now live on the careers page.'],
  unpublish: ['unpublished', 'is off the careers page and back in drafts.'],
  archive: ['archived', 'is archived. You can restore it at any time.'],
  restore: ['restored', 'is back in drafts.'],
};

router.post('/:id/status', async (req, res) => {
  const action = Object.hasOwn(jobs.MOVES, req.body.action) ? req.body.action : null;
  if (!action) {
    setFlash(req, 'error', 'That change isn’t possible.');
    return res.redirect(303, `/portal/jobs/${req.job.id}`);
  }
  if (!userCan(req.user, MOVE_PERMISSION[action])) {
    const err = new Error('Your role doesn’t include access to this page.');
    err.status = 403;
    throw err;
  }
  if (action === 'publish') {
    const problems = jobs.publishProblems(req.job);
    if (Object.keys(problems).length) {
      setFlash(req, 'error', Object.values(problems).join(' '));
      return res.redirect(303, `/portal/jobs/${req.job.id}`);
    }
  }
  const updated = await jobs.move(req.job, action, req.user);
  if (!updated) {
    setFlash(req, 'error', `This job is ${jobs.STATUS_LABELS[req.job.status].toLowerCase()}, so it can’t be ${MOVE_TEXT[action][0]}.`);
  } else {
    await audit(req, { action: `job.${action}`, entityType: 'job', entityId: req.job.id, summary: `${req.user.name} ${MOVE_TEXT[action][0]} the job “${req.job.title}”` });
    setFlash(req, 'success', `“${req.job.title}” ${MOVE_TEXT[action][1]}`);
  }
  res.redirect(303, `/portal/jobs/${req.job.id}`);
});

router.post('/:id/copy', can('jobs.edit'), async (req, res) => {
  const job = await jobs.copy(req.job, req.user);
  await audit(req, { action: 'job.create', entityType: 'job', entityId: job.id, summary: `${req.user.name} copied “${req.job.title}” into a new draft` });
  setFlash(req, 'success', 'Copied into a new draft. Change the details, then publish when ready.');
  res.redirect(303, `/portal/jobs/${job.id}`);
});

router.post('/:id/delete', can('jobs.delete'), async (req, res) => {
  if (req.job.status !== 'archived') {
    setFlash(req, 'error', 'Archive the job first. Only archived jobs can be deleted permanently.');
    return res.redirect(303, `/portal/jobs/${req.job.id}`);
  }
  await jobs.remove(req.job.id);
  await audit(req, { action: 'job.delete', entityType: 'job', entityId: req.job.id, summary: `${req.user.name} permanently deleted the job “${req.job.title}”` });
  setFlash(req, 'success', `“${req.job.title}” deleted permanently.`);
  res.redirect(303, '/portal/jobs?tab=archived');
});

module.exports = router;
