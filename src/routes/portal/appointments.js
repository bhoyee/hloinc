'use strict';

const express = require('express');
const db = require('../../db/knex');
const appts = require('../../services/appointments');
const emails = require('../../services/appointmentEmails');
const notifications = require('../../services/notifications');
const content = require('../../services/content');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso, isIsoDate, withinOfficeHours } = require('../../lib/hours');
const { scheduleSchema, logSchema, cancelSchema, notesSchema, typeSchema } = require('../../validation/appointments');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const apptCrumbs = [...crumbs, { label: 'Appointments', href: '/portal/appointments' }];
const can = requirePermission;

const activeTypes = () => db('appointment_types').where({ active: true }).orderBy('sort_order').orderBy('name');
const todayIso = () => marylandParts(new Date()).date;

/**
 * Booking checks: capacity for the type and office hours. Returns a list of
 * problems; staff can still go ahead by ticking "book anyway".
 */
async function bookingProblems({ type, start, duration, excludeId }) {
  const problems = [];
  const others = await appts.overlapping(type.id, start, duration, excludeId);
  if (others >= type.capacity) {
    problems.push(`${type.name} is already fully booked at that time (${others} of ${type.capacity}).`);
  }
  const site = await content.getBusiness();
  if (!withinOfficeHours(site.schedule, start, new Date(start.getTime() + duration * 60000))) {
    problems.push('That time is outside office hours.');
  }
  if (start < new Date()) problems.push('That time is in the past.');
  return problems;
}

async function notifyAssignee(req, appt, previousAssignee) {
  if (!appt.assigned_to || appt.assigned_to === previousAssignee || appt.assigned_to === req.user.id) return;
  await notifications.notifyUser(appt.assigned_to, {
    type: 'appointment',
    title: `You’ve been assigned: ${appt.type_name}`,
    body: `${appt.name} · ${emails.when(appt.scheduled_at)}`,
    link: `/portal/appointments/${appt.id}`,
  });
}

// --- List -----------------------------------------------------------------------------

router.get('/', can('appointments.view'), async (req, res) => {
  const str = (v) => (typeof v === 'string' ? v.trim().slice(0, 100) : '');
  const tab = appts.TABS[req.query.tab] ? req.query.tab : 'requests';
  const filters = { q: str(req.query.q), status: str(req.query.status), type: /^\d+$/.test(req.query.type || '') ? req.query.type : '', source: str(req.query.source) };
  const result = await appts.list({ tab, ...filters, page: req.query.page });
  const pageUrl = (p) => `/portal/appointments?${new URLSearchParams(Object.entries({ tab, ...filters, page: p > 1 ? p : '' }).filter(([, v]) => v))}`;
  res.render('pages/portal/appointments/index.njk', {
    title: 'Appointments',
    subheading: 'Website requests, walk-ins and phone bookings.',
    crumbs,
    tab,
    tabs: Object.entries(appts.TABS).map(([key, t]) => ({ key, label: t.label })),
    counts: await appts.tabCounts(),
    ...result,
    filters,
    types: await db('appointment_types').orderBy('sort_order').orderBy('name'),
    statusLabels: appts.STATUS_LABELS,
    sourceLabels: appts.SOURCE_LABELS,
    windowLabels: appts.WINDOW_LABELS,
    prevUrl: result.page > 1 ? pageUrl(result.page - 1) : null,
    nextUrl: result.page < result.pages ? pageUrl(result.page + 1) : null,
  });
});

// --- Calendar -------------------------------------------------------------------------

router.get('/calendar', can('appointments.view'), async (req, res) => {
  const view = req.query.view === 'month' ? 'month' : 'week';
  const anchor = isIsoDate(req.query.date) ? req.query.date : todayIso();

  let first;
  let days;
  let prev;
  let next;
  let label;
  if (view === 'week') {
    first = weekStartIso(anchor);
    days = 7;
    prev = addDaysIso(first, -7);
    next = addDaysIso(first, 7);
    const end = addDaysIso(first, 6);
    const fmt = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
    label = `${fmt(first, { month: 'short', day: 'numeric' })} – ${fmt(end, { month: 'short', day: 'numeric', year: 'numeric' })}`;
  } else {
    const monthStart = `${anchor.slice(0, 7)}-01`;
    const nextMonth = addDaysIso(monthStart, 32).slice(0, 7);
    first = weekStartIso(monthStart);
    const lastGridDay = addDaysIso(weekStartIso(addDaysIso(`${nextMonth}-01`, -1)), 6);
    days = Math.round((new Date(`${lastGridDay}T12:00:00Z`) - new Date(`${first}T12:00:00Z`)) / 86400000) + 1;
    prev = addDaysIso(monthStart, -1).slice(0, 7) + '-01';
    next = `${nextMonth}-01`;
    label = new Date(`${monthStart}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
  }

  const rangeStart = marylandDateTime(first, '00:00');
  const rangeEnd = marylandDateTime(addDaysIso(first, days), '00:00');
  const items = await appts.between(rangeStart, rangeEnd);
  const byDay = {};
  for (const a of items) (byDay[marylandParts(a.scheduled_at).date] ||= []).push(a);

  const today = todayIso();
  const month = anchor.slice(0, 7);
  const grid = Array.from({ length: days }, (_, i) => {
    const date = addDaysIso(first, i);
    return {
      date,
      items: byDay[date] || [],
      isToday: date === today,
      inMonth: view === 'week' || date.slice(0, 7) === month,
      dow: new Date(`${date}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
      dayNum: Number(date.slice(8)),
    };
  });

  res.render('pages/portal/appointments/calendar.njk', {
    title: 'Appointment calendar',
    crumbs: apptCrumbs,
    view,
    label,
    grid,
    anchor,
    prev,
    next,
    today,
    waiting: await appts.waiting(10),
    statusLabels: appts.STATUS_LABELS,
    windowLabels: appts.WINDOW_LABELS,
  });
});

// --- Log a walk-in or phone appointment -------------------------------------------------

async function renderLog(req, res, { values, errors = {}, problems = [], status = 200 } = {}) {
  const now = marylandParts(new Date());
  const types = await activeTypes();
  res.status(status).render('pages/portal/appointments/log.njk', {
    title: 'Log a walk-in or phone appointment',
    crumbs: apptCrumbs,
    types,
    staff: await appts.staffOptions(),
    values: values || {
      source: 'walk_in',
      type_id: types[0] ? String(types[0].id) : '',
      date: now.date,
      time: `${String(Math.floor(now.hour)).padStart(2, '0')}:${String(Math.floor((now.hour % 1) * 60 / 15) * 15).padStart(2, '0')}`,
      duration_minutes: types[0] ? types[0].duration_minutes : appts.DEFAULT_DURATION,
    },
    errors,
    problems,
  });
}

router.get('/new', can('appointments.log'), (req, res) => renderLog(req, res));

router.post('/', can('appointments.log'), async (req, res) => {
  const parsed = logSchema.safeParse(req.body);
  if (!parsed.success) return renderLog(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;
  const type = await db('appointment_types').where({ id: d.type_id, active: true }).first();
  if (!type) return renderLog(req, res, { values: req.body, errors: { type_id: 'Choose an appointment type.' }, status: 422 });

  const start = marylandDateTime(d.date, d.time);
  // A walk-in happening now is expected; only warn about past times for phone bookings.
  const problems = (await bookingProblems({ type, start, duration: d.duration_minutes })).filter(
    (p) => !(d.source === 'walk_in' && p.startsWith('That time is in the past'))
  );
  if (problems.length && d.override !== 'yes') return renderLog(req, res, { values: req.body, problems, status: 422 });

  const appt = await appts.create({
    type_id: type.id,
    source: d.source,
    status: 'confirmed',
    name: d.name,
    email: d.email || null,
    phone: d.phone || null,
    preferred_contact: d.email && !d.phone ? 'email' : 'phone',
    scheduled_at: start,
    duration_minutes: d.duration_minutes,
    assigned_to: d.assigned_to,
    notes: d.notes || null,
    staff_notes: d.staff_notes || null,
    created_by: req.user.id,
    handled_by: req.user.id,
  });
  await audit(req, {
    action: 'appointment.log',
    entityType: 'appointment',
    entityId: appt.id,
    summary: `${req.user.name} logged a ${appts.SOURCE_LABELS[d.source].toLowerCase()} appointment (#${appt.id}, ${type.name})`,
    metadata: problems.length ? { bookedAnyway: problems } : undefined,
  });
  await notifyAssignee(req, appt, null);
  let sent = null;
  if (d.notify === 'yes') sent = (await emails.confirmed(appt)).ok;
  setFlash(req, sent === false ? 'warning' : 'success', sent === false ? 'Appointment logged, but the confirmation email could not be sent.' : `Appointment logged${sent ? ' and confirmation emailed' : ''}.`);
  res.redirect(303, `/portal/appointments/${appt.id}`);
});

// --- Appointment types (manage_types) ----------------------------------------------------

const typeCrumbs = [...apptCrumbs, { label: 'Appointment types', href: '/portal/appointments/types' }];

router.get('/types', can('appointments.manage_types'), async (req, res) => {
  const types = await db('appointment_types as t')
    .leftJoin('appointments as a', 'a.type_id', 't.id')
    .select('t.*')
    .count({ uses: 'a.id' })
    .groupBy('t.id')
    .orderBy('t.sort_order')
    .orderBy('t.name');
  res.render('pages/portal/appointments/types.njk', {
    title: 'Appointment types',
    subheading: 'What visitors can request on the website, and how long each takes.',
    crumbs: apptCrumbs,
    types,
  });
});

function renderType(res, { type = null, values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/appointments/type-form.njk', {
    title: type ? type.name : 'New appointment type',
    crumbs: typeCrumbs,
    type,
    values,
    errors,
  });
}

router.get('/types/new', can('appointments.manage_types'), (req, res) =>
  renderType(res, { values: { duration_minutes: 30, capacity: 1, active: 'yes', sort_order: 0 } })
);

router.post('/types', can('appointments.manage_types'), async (req, res) => {
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return renderType(res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;
  const [id] = await db('appointment_types').insert({ ...d, active: d.active === 'yes' });
  await audit(req, { action: 'appointment_type.create', entityType: 'appointment_type', entityId: id, summary: `${req.user.name} added the appointment type “${d.name}”` });
  setFlash(req, 'success', `“${d.name}” added.`);
  res.redirect(303, '/portal/appointments/types');
});

router.param('typeId', async (req, res, next, id) => {
  req.apptType = /^\d+$/.test(id) ? await db('appointment_types').where({ id }).first() : null;
  if (!req.apptType) {
    const err = new Error('That appointment type doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

router.get('/types/:typeId', can('appointments.manage_types'), (req, res) =>
  renderType(res, { type: req.apptType, values: { ...req.apptType, active: req.apptType.active ? 'yes' : '' } })
);

router.post('/types/:typeId', can('appointments.manage_types'), async (req, res) => {
  const parsed = typeSchema.safeParse(req.body);
  if (!parsed.success) return renderType(res, { type: req.apptType, values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;
  await db('appointment_types').where({ id: req.apptType.id }).update({ ...d, active: d.active === 'yes' });
  await audit(req, { action: 'appointment_type.update', entityType: 'appointment_type', entityId: req.apptType.id, summary: `${req.user.name} updated the appointment type “${d.name}”` });
  setFlash(req, 'success', 'Appointment type saved.');
  res.redirect(303, '/portal/appointments/types');
});

router.post('/types/:typeId/delete', can('appointments.manage_types'), async (req, res) => {
  const used = await db('appointments').where({ type_id: req.apptType.id }).first();
  if (used) {
    setFlash(req, 'error', 'This type has appointments, so it can’t be deleted. Untick “Available” to hide it from the website instead.');
    return res.redirect(303, `/portal/appointments/types/${req.apptType.id}`);
  }
  await db('appointment_types').where({ id: req.apptType.id }).del();
  await audit(req, { action: 'appointment_type.delete', entityType: 'appointment_type', entityId: req.apptType.id, summary: `${req.user.name} deleted the appointment type “${req.apptType.name}”` });
  setFlash(req, 'success', `“${req.apptType.name}” deleted.`);
  res.redirect(303, '/portal/appointments/types');
});

// --- One appointment -----------------------------------------------------------------------

router.param('id', async (req, res, next, id) => {
  req.appt = /^\d+$/.test(id) ? await appts.get(Number(id)) : null;
  if (!req.appt) {
    const err = new Error('That appointment doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

/** Opening an appointment shows personal details: record it (once per person per 30 minutes). */
async function auditView(req) {
  const recent = await db('audit_log')
    .where({ action: 'appointment.view', user_id: req.user.id, entity_type: 'appointment', entity_id: String(req.appt.id) })
    .where('created_at', '>', new Date(Date.now() - 30 * 60 * 1000))
    .first();
  if (!recent) {
    await audit(req, { action: 'appointment.view', entityType: 'appointment', entityId: req.appt.id, summary: `${req.user.name} viewed appointment #${req.appt.id} (${req.appt.name})` });
  }
}

async function renderShow(req, res, { scheduleValues, scheduleErrors = {}, problems = [], status = 200 } = {}) {
  const a = req.appt;
  const parts = a.scheduled_at ? marylandParts(a.scheduled_at) : null;
  const history = await db('audit_log')
    .select('summary', 'created_at', 'action')
    .where({ entity_type: 'appointment', entity_id: String(a.id) })
    .whereNot({ action: 'appointment.view' })
    .orderBy('id', 'desc')
    .limit(20);
  res.status(status).render('pages/portal/appointments/show.njk', {
    title: `${a.name}`,
    subheading: `${a.type_name} · ${appts.STATUS_LABELS[a.status]}`,
    crumbs: apptCrumbs,
    a,
    staff: await appts.staffOptions(),
    statusLabels: appts.STATUS_LABELS,
    sourceLabels: appts.SOURCE_LABELS,
    windowLabels: appts.WINDOW_LABELS,
    transitions: appts.TRANSITIONS,
    scheduleValues: scheduleValues || {
      date: parts ? parts.date : a.requested_date || todayIso(),
      time: parts ? parts.time : a.requested_window === 'afternoon' ? '13:00' : '09:00',
      duration_minutes: a.duration_minutes || a.type_duration || appts.DEFAULT_DURATION,
      assigned_to: a.assigned_to ? String(a.assigned_to) : '',
      notify: a.email ? 'yes' : '',
    },
    scheduleErrors,
    problems,
    history,
    calendarDate: parts ? parts.date : '',
    isPast: a.scheduled_at && new Date(a.scheduled_at) < new Date(),
  });
}

router.get('/:id', can('appointments.view'), async (req, res) => {
  await auditView(req);
  await renderShow(req, res);
});

// Confirm a request, or change a confirmed appointment's time / assignee.
router.post('/:id/schedule', can('appointments.edit'), async (req, res) => {
  const a = req.appt;
  if (!appts.TRANSITIONS.confirm.includes(a.status)) {
    setFlash(req, 'error', 'Only requested or confirmed appointments can be scheduled.');
    return res.redirect(303, `/portal/appointments/${a.id}`);
  }
  const parsed = scheduleSchema.safeParse(req.body);
  if (!parsed.success) return renderShow(req, res, { scheduleValues: req.body, scheduleErrors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;

  const start = marylandDateTime(d.date, d.time);
  const type = await db('appointment_types').where({ id: a.type_id }).first();
  const problems = await bookingProblems({ type, start, duration: d.duration_minutes, excludeId: a.id });
  if (problems.length && d.override !== 'yes') return renderShow(req, res, { scheduleValues: req.body, problems, status: 422 });

  const wasConfirmed = a.status === 'confirmed';
  const timeChanged = !a.scheduled_at || new Date(a.scheduled_at).getTime() !== start.getTime();
  const updated = await appts.transition(a.id, 'confirm', {
    scheduled_at: start,
    duration_minutes: d.duration_minutes,
    assigned_to: d.assigned_to,
    handled_by: req.user.id,
  });
  await audit(req, {
    action: wasConfirmed ? 'appointment.reschedule' : 'appointment.confirm',
    entityType: 'appointment',
    entityId: a.id,
    summary: wasConfirmed
      ? `${req.user.name} changed appointment #${a.id} to ${emails.when(start)}`
      : `${req.user.name} confirmed appointment #${a.id} for ${emails.when(start)}`,
    metadata: problems.length ? { bookedAnyway: problems } : undefined,
  });
  await notifyAssignee(req, updated, a.assigned_to);

  let note = wasConfirmed ? 'Appointment updated.' : 'Appointment confirmed.';
  let kind = 'success';
  if (d.notify === 'yes' && (timeChanged || !wasConfirmed)) {
    const sent = await emails.confirmed(updated, { rescheduled: wasConfirmed, message: d.message });
    if (sent.ok) note += ` We emailed ${updated.email}.`;
    else {
      kind = 'warning';
      note += updated.email ? ' The email to the visitor could not be sent, so please call them.' : ' There’s no email address, so please call them to confirm.';
    }
  }
  setFlash(req, kind, note);
  res.redirect(303, `/portal/appointments/${a.id}`);
});

// Outcomes: completed / no-show / reopen.
router.post('/:id/status', can('appointments.edit'), async (req, res) => {
  const action = ['complete', 'no_show', 'reopen'].includes(req.body.action) ? req.body.action : null;
  const updated = action && (await appts.transition(req.appt.id, action, { handled_by: req.user.id }));
  if (!updated) {
    setFlash(req, 'error', 'That change isn’t possible for this appointment.');
  } else {
    const verb = { complete: 'marked as completed', no_show: 'marked as a no-show', reopen: 'reopened' }[action];
    await audit(req, { action: `appointment.${action}`, entityType: 'appointment', entityId: req.appt.id, summary: `${req.user.name} ${verb} appointment #${req.appt.id}` });
    setFlash(req, 'success', `Appointment ${verb}.`);
  }
  res.redirect(303, `/portal/appointments/${req.appt.id}`);
});

router.post('/:id/cancel', can('appointments.archive'), async (req, res) => {
  const parsed = cancelSchema.safeParse(req.body);
  const d = parsed.success ? parsed.data : { reason: '', notify: undefined };
  const updated = await appts.transition(req.appt.id, 'cancel', { cancel_reason: d.reason || null, handled_by: req.user.id });
  if (!updated) {
    setFlash(req, 'error', 'This appointment can’t be cancelled.');
    return res.redirect(303, `/portal/appointments/${req.appt.id}`);
  }
  await audit(req, { action: 'appointment.cancel', entityType: 'appointment', entityId: req.appt.id, summary: `${req.user.name} cancelled appointment #${req.appt.id}${d.reason ? ` (${d.reason})` : ''}` });
  let msg = 'Appointment cancelled.';
  let kind = 'success';
  if (d.notify === 'yes') {
    const sent = await emails.cancelled(updated, { reason: d.reason });
    if (sent.ok) msg += ` We emailed ${updated.email}.`;
    else {
      kind = 'warning';
      msg += ' The visitor could not be emailed, so please call them.';
    }
  }
  setFlash(req, kind, msg);
  res.redirect(303, `/portal/appointments/${req.appt.id}`);
});

router.post('/:id/notes', can('appointments.edit'), async (req, res) => {
  const parsed = notesSchema.safeParse(req.body);
  if (!parsed.success) {
    setFlash(req, 'error', 'Keep notes under 2,000 characters.');
    return res.redirect(303, `/portal/appointments/${req.appt.id}`);
  }
  await appts.updateNotes(req.appt.id, parsed.data.staff_notes);
  await audit(req, { action: 'appointment.notes', entityType: 'appointment', entityId: req.appt.id, summary: `${req.user.name} updated staff notes on appointment #${req.appt.id}` });
  setFlash(req, 'success', 'Notes saved.');
  res.redirect(303, `/portal/appointments/${req.appt.id}#notes`);
});

router.post('/:id/delete', can('appointments.delete'), async (req, res) => {
  if (req.body.confirm !== 'yes') {
    setFlash(req, 'error', 'Tick the box to confirm permanent deletion.');
    return res.redirect(303, `/portal/appointments/${req.appt.id}`);
  }
  await audit(req, {
    action: 'appointment.delete',
    entityType: 'appointment',
    entityId: req.appt.id,
    summary: `${req.user.name} permanently deleted appointment #${req.appt.id} (${req.appt.type_name})`,
  });
  await appts.remove(req.appt.id);
  setFlash(req, 'success', `Appointment #${req.appt.id} permanently deleted.`);
  res.redirect(303, '/portal/appointments?tab=all');
});

module.exports = router;
