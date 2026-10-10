'use strict';

const express = require('express');
const { z } = require('zod');
const db = require('../../db/knex');
const leads = require('../../services/leads');
const roles = require('../../services/roles');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { setFlash } = require('../../lib/forms');
const { phoneField } = require('../../validation/phone');
const areas = require('../../content/areas');

const router = express.Router();
const can = requirePermission;
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const leadCrumbs = [...crumbs, { label: 'Leads', href: '/portal/leads' }];

const noteSchema = z.string().trim().min(1, 'Write a note first.').max(2000, 'Keep notes under 2,000 characters.');
const detailsSchema = z.object({
  name: z.string().trim().min(1, 'Enter a name.').max(120, 'Keep the name under 120 characters.'),
  email: z.string().trim().max(191).refine((v) => v === '' || /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(v), 'Enter a valid email address.'),
  phone: phoneField(),
  county: z.string().trim().max(80),
});

/** Staff who can work leads (for the owner picker). */
async function owners() {
  const keys = (await roles.list()).filter((r) => r.permissions.has('leads.edit')).map((r) => r.key);
  return db('users').whereIn('role', keys).where({ status: 'active' }).select('id', 'name').orderBy('name');
}

function readFilters(query) {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  return {
    tab: leads.TABS[query.tab] ? query.tab : 'open',
    q: str(query.q),
    origin: leads.ORIGIN_LABELS[query.origin] ? query.origin : '',
    owner: ['me', 'none'].includes(query.owner) ? query.owner : '',
  };
}
const queryString = (filters, extra = {}) => new URLSearchParams(Object.entries({ ...filters, ...extra }).filter(([k, v]) => v && !(k === 'tab' && v === 'open'))).toString();

// --- List -------------------------------------------------------------------------------

router.get('/', async (req, res) => {
  const filters = readFilters(req.query);
  const result = await leads.list(req.user, { ...filters, page: req.query.page });
  const pageUrl = (p) => `/portal/leads?${queryString(filters, { page: p > 1 ? p : '' })}`;
  res.render('pages/portal/leads/index.njk', {
    title: 'Leads',
    subheading: 'Everyone who has reached out, and where they are in intake.',
    crumbs,
    filters,
    tabs: Object.entries(leads.TABS).map(([key, t]) => ({ key, label: t.label })),
    ...result,
    stages: leads.STAGES,
    originLabels: leads.ORIGIN_LABELS,
    exportUrl: `/portal/leads/export.csv?${queryString(filters)}`,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
  });
});

router.get('/export.csv', can('leads.export'), async (req, res) => {
  const filters = readFilters(req.query);
  const rows = await leads.exportRows(req.user, filters);
  await audit(req, { action: 'leads.export', entityType: 'lead', summary: `${req.user.name} exported ${rows.length} ${rows.length === 1 ? 'lead' : 'leads'} to CSV (${leads.TABS[filters.tab].label}${filters.q ? `, search "${filters.q}"` : ''})` });
  const day = new Date().toISOString().slice(0, 10);
  res.set('Content-Type', 'text/csv; charset=utf-8');
  res.set('Content-Disposition', `attachment; filename="hlo-leads-${day}.csv"`);
  res.set('Cache-Control', 'no-store');
  res.send(`﻿${leads.toCsv(rows)}`); // BOM so Excel reads accents correctly
});

// --- One lead ---------------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.lead = /^\d+$/.test(id) ? await leads.get(Number(id)) : null;
  if (!req.lead) {
    const err = new Error('That lead doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

async function renderShow(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  const l = req.lead;
  const chosen = l.services ? (typeof l.services === 'string' ? JSON.parse(l.services) : l.services) : [];
  res.status(status).render('pages/portal/leads/show.njk', {
    title: l.name,
    subheading: l.referred_by ? `Referred by ${l.referred_by}` : `First came in as: ${leads.ORIGIN_LABELS[l.origin].toLowerCase()}`,
    crumbs: leadCrumbs,
    l,
    serviceNames: chosen.map(leads.serviceName).filter(Boolean),
    timeline: await leads.timeline(l, req.user),
    stages: leads.STAGES,
    originLabels: leads.ORIGIN_LABELS,
    owners: req.user.permissions.has('leads.edit') ? await owners() : [],
    counties: areas.flatMap((r) => r.counties),
    values: { name: l.name, email: l.email || '', phone: l.phone || '', county: l.county || '', ...values },
    errors,
  });
}

router.get('/:id', async (req, res) => {
  // Personal details: record the view (once per person per 30 minutes).
  const recent = await db('audit_log').where({ action: 'lead.view', user_id: req.user.id, entity_type: 'lead', entity_id: String(req.lead.id) })
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000)).first();
  if (!recent) await audit(req, { action: 'lead.view', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} viewed lead ${req.lead.name}` });
  await renderShow(req, res);
});

const back = (req, res, hash = '') => res.redirect(303, `/portal/leads/${req.lead.id}${hash}`);

router.post('/:id/stage', can('leads.edit'), async (req, res) => {
  const stage = Object.hasOwn(leads.STAGES, req.body.stage) ? req.body.stage : null;
  if (stage && (await leads.setStage(req.lead, stage, req.user))) {
    await audit(req, { action: 'lead.stage', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} moved lead ${req.lead.name} to ${leads.STAGES[stage].label}` });
    setFlash(req, 'success', `Stage set to ${leads.STAGES[stage].label}.`);
  }
  back(req, res);
});

router.post('/:id/owner', can('leads.edit'), async (req, res) => {
  const raw = req.body.owner_id === 'me' ? String(req.user.id) : String(req.body.owner_id || '');
  const owner = raw ? (await owners()).find((o) => String(o.id) === raw) : null;
  if (raw && !owner) {
    setFlash(req, 'error', 'Choose someone who can work on leads.');
    return back(req, res);
  }
  if (await leads.setOwner(req.lead, owner, req.user)) {
    await audit(req, { action: 'lead.owner', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} ${owner ? `assigned lead ${req.lead.name} to ${owner.name}` : `removed the owner of lead ${req.lead.name}`}` });
    if (owner && owner.id !== req.user.id) {
      await notifications.notifyUser(owner.id, { type: 'lead', title: `${req.user.name} gave you a lead`, body: req.lead.name, link: `/portal/leads/${req.lead.id}` });
    }
    setFlash(req, 'success', owner ? `Owner set to ${owner.id === req.user.id ? 'you' : owner.name}.` : 'Owner removed.');
  }
  back(req, res);
});

router.post('/:id/details', can('leads.edit'), async (req, res) => {
  const parsed = detailsSchema.safeParse(req.body);
  if (!parsed.success) {
    const errors = Object.fromEntries(parsed.error.issues.map((i) => [i.path[0], i.message]));
    return renderShow(req, res, { values: req.body, errors, status: 422 });
  }
  if (await leads.updateDetails(req.lead, parsed.data, req.user)) {
    await audit(req, { action: 'lead.details', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} updated the details of lead ${parsed.data.name}` });
    setFlash(req, 'success', 'Details saved.');
  }
  back(req, res);
});

router.post('/:id/note', can('leads.edit'), async (req, res) => {
  const parsed = noteSchema.safeParse(req.body.note);
  if (!parsed.success) return renderShow(req, res, { values: req.body, errors: { note: parsed.error.issues[0].message }, status: 422 });
  await leads.addNote(req.lead, parsed.data, req.user);
  await audit(req, { action: 'lead.note', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} added a note to lead ${req.lead.name}` });
  setFlash(req, 'success', 'Note added.');
  back(req, res, '#timeline');
});

router.post('/:id/delete', can('leads.delete'), async (req, res) => {
  await leads.remove(req.lead.id);
  await audit(req, { action: 'lead.delete', entityType: 'lead', entityId: req.lead.id, summary: `${req.user.name} deleted lead ${req.lead.name} (messages and appointments are kept)` });
  setFlash(req, 'success', `Lead ${req.lead.name} deleted. Their messages and appointments are still in the inbox and calendar.`);
  res.redirect(303, '/portal/leads');
});

module.exports = router;
