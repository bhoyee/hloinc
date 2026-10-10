'use strict';

const express = require('express');
const schedule = require('../../services/schedule');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { requirePermission } = require('../../middleware/auth');
const { can } = require('../../auth/permissions');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso, isIsoDate } = require('../../lib/hours');
const { shiftSchema } = require('../../validation/appointments');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];
const scheduleCrumbs = [...crumbs, { label: 'Schedule', href: '/portal/schedule' }];

const rangeLabel = (s) => {
  const fmt = (d, o) => new Date(d).toLocaleString('en-US', { timeZone: 'America/New_York', ...o }).replace(':00', '').replace(' AM', ' a.m.').replace(' PM', ' p.m.');
  const start = marylandParts(s.start_at);
  const end = marylandParts(new Date(new Date(s.end_at).getTime() - 1));
  if (start.time === '00:00' && marylandParts(s.end_at).time === '00:00') return start.date === end.date ? 'All day' : 'All day (multi-day)';
  return `${fmt(s.start_at, { hour: 'numeric', minute: '2-digit' })} – ${fmt(s.end_at, { hour: 'numeric', minute: '2-digit' })}${start.date !== marylandParts(s.end_at).date ? ' (+1 day)' : ''}`;
};

/**
 * Team week view or "My schedule". Everyone sees their own shifts
 * (requirements §5.2); the team view shows only the people this role can see
 * (Roles & permissions → Staff schedule), e.g. a Program Director sees the
 * coordinators, intake and reception staff but not the CEO/COO.
 */
router.get('/', async (req, res) => {
  const teamAllowed = can(req.user, 'schedule.view') && req.user.scheduleScope.mode !== 'own';
  const view = teamAllowed && req.query.view !== 'mine' ? 'team' : 'mine';
  const today = marylandParts(new Date()).date;
  const week = weekStartIso(isIsoDate(req.query.week) ? req.query.week : today);
  const days = Array.from({ length: 7 }, (_, i) => {
    const date = addDaysIso(week, i);
    const d = new Date(`${date}T12:00:00Z`);
    return {
      date,
      isToday: date === today,
      dow: d.toLocaleDateString('en-US', { timeZone: 'UTC', weekday: 'short' }),
      label: d.toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short', day: 'numeric' }),
    };
  });
  const from = marylandDateTime(week, '00:00');
  const to = marylandDateTime(addDaysIso(week, 7), '00:00');
  const entries = await schedule.between(from, to, view === 'mine' ? req.user.id : await schedule.visibleIds(req.user));

  // Place each entry on every day it touches (overnight shifts span two).
  const cell = {};
  for (const s of entries) {
    s.range = rangeLabel(s);
    for (const day of days) {
      const dayStart = marylandDateTime(day.date, '00:00');
      const dayEnd = marylandDateTime(addDaysIso(day.date, 1), '00:00');
      if (new Date(s.start_at) < dayEnd && new Date(s.end_at) > dayStart) {
        (cell[`${s.user_id}|${day.date}`] ||= []).push(s);
        (cell[`me|${day.date}`] ||= []).push(s);
      }
    }
  }

  // Team view search: staff name or role (e.g. "intake").
  const q = typeof req.query.q === 'string' ? req.query.q.trim().slice(0, 100) : '';
  let people = view === 'team' ? await schedule.staff(req.user) : [{ id: req.user.id, name: req.user.name }];
  if (view === 'team') {
    const roleLabels = await require('../../services/roles').labels();
    people = people.map((p) => ({ ...p, roleLabel: roleLabels[p.role] || '' }));
    if (q) {
      const needle = q.toLowerCase();
      people = people.filter((p) => p.name.toLowerCase().includes(needle) || p.roleLabel.toLowerCase().includes(needle));
    }
  }
  const fmtWeek = (d, o) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...o });
  res.render('pages/portal/schedule/index.njk', {
    title: view === 'team' ? 'Staff schedule' : 'My schedule',
    crumbs,
    view,
    teamAllowed,
    week,
    prevWeek: addDaysIso(week, -7),
    nextWeek: addDaysIso(week, 7),
    thisWeek: weekStartIso(today),
    weekLabel: `${fmtWeek(week, { month: 'short', day: 'numeric' })} – ${fmtWeek(addDaysIso(week, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`,
    days,
    people,
    cell,
    kindLabels: schedule.KIND_LABELS,
    totalEntries: entries.length,
    q,
    keep: q ? `&q=${encodeURIComponent(q)}` : '',
    timeOffWaiting: (await require('../../services/timeOff').pendingFor(req.user)) || 0,
  });
});

// --- Add / edit (schedule.edit) ------------------------------------------------------

async function renderForm(req, res, { shift = null, values, errors = {}, status = 200 }) {
  res.status(status).render('pages/portal/schedule/form.njk', {
    title: shift ? `Edit ${shift.kind === 'time_off' ? 'time off' : 'shift'}` : 'Add to the schedule',
    crumbs: scheduleCrumbs,
    shift,
    values,
    errors,
    staff: await schedule.staff(req.user),
  });
}

function valuesFromShift(s) {
  const start = marylandParts(s.start_at);
  const end = marylandParts(s.end_at);
  const allDay = start.time === '00:00' && end.time === '00:00';
  return {
    user_id: String(s.user_id),
    kind: s.kind,
    date: start.date,
    all_day: allDay ? 'yes' : '',
    start_time: allDay ? '09:00' : start.time,
    end_time: allDay ? '17:00' : end.time,
    label: s.label || '',
    location: s.location || '',
    notes: s.notes || '',
  };
}

async function tellPerson(req, userId, title, body) {
  if (userId === req.user.id) return;
  await notifications.notifyUser(userId, { type: 'schedule', title, body, link: '/portal/schedule?view=mine' });
}

router.get('/new', requirePermission('schedule.edit'), (req, res) =>
  renderForm(req, res, {
    values: {
      user_id: /^\d+$/.test(req.query.user || '') ? req.query.user : '',
      kind: 'shift',
      date: isIsoDate(req.query.date) ? req.query.date : marylandParts(new Date()).date,
      start_time: '09:00',
      end_time: '17:00',
      repeat_weeks: 1,
    },
  })
);

router.post('/', requirePermission('schedule.edit'), async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;
  if (!(await schedule.canSee(req.user, d.user_id))) {
    return renderForm(req, res, { values: req.body, errors: { user_id: 'Choose someone whose schedule you manage.' }, status: 422 });
  }
  const { created, skipped } = await schedule.create(d, { repeatWeeks: d.repeat_weeks, createdBy: req.user.id });
  if (!created.length) {
    return renderForm(req, res, { values: req.body, errors: { date: 'This person already has something on the schedule at that time.' }, status: 422 });
  }
  const first = await schedule.get(created[0]);
  const what = d.kind === 'time_off' ? 'time off' : 'a shift';
  await audit(req, {
    action: 'shift.create',
    entityType: 'shift',
    entityId: created[0],
    summary: `${req.user.name} added ${what} for ${first.user_name}${created.length > 1 ? ` (${created.length} weeks)` : ''}`,
    metadata: { ids: created, skipped: skipped.length },
  });
  await tellPerson(req, d.user_id, `New on your schedule: ${rangeLabel(first)}`, `${first.start_at.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })}${created.length > 1 ? `, repeating ${created.length} weeks` : ''}`);
  setFlash(req, skipped.length ? 'warning' : 'success', skipped.length
    ? `Added ${created.length} ${created.length === 1 ? 'entry' : 'entries'}. ${skipped.length} week(s) skipped because they clashed with existing entries.`
    : `Added to ${first.user_name}’s schedule.`);
  res.redirect(303, `/portal/schedule?week=${marylandParts(first.start_at).date}`);
});

router.param('id', async (req, res, next, id) => {
  req.shift = /^\d+$/.test(id) ? await schedule.get(Number(id)) : null;
  // Someone outside this role's view looks the same as not existing.
  if (req.shift && !(await schedule.canSee(req.user, req.shift.user_id))) req.shift = null;
  if (!req.shift) {
    const err = new Error('That schedule entry doesn’t exist.');
    err.status = 404;
    return next(err);
  }
  next();
});

router.get('/:id', requirePermission('schedule.edit'), (req, res) => renderForm(req, res, { shift: req.shift, values: valuesFromShift(req.shift) }));

router.post('/:id', requirePermission('schedule.edit'), async (req, res) => {
  const parsed = shiftSchema.safeParse(req.body);
  if (!parsed.success) return renderForm(req, res, { shift: req.shift, values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  const d = parsed.data;
  if (!(await schedule.canSee(req.user, d.user_id))) {
    return renderForm(req, res, { shift: req.shift, values: req.body, errors: { user_id: 'Choose someone whose schedule you manage.' }, status: 422 });
  }
  const range = schedule.toRange(d);
  if ((await schedule.clashes(d.user_id, range.start, range.end, req.shift.id)).length) {
    return renderForm(req, res, { shift: req.shift, values: req.body, errors: { date: 'This person already has something on the schedule at that time.' }, status: 422 });
  }
  const updated = await schedule.update(req.shift.id, d);
  await audit(req, { action: 'shift.update', entityType: 'shift', entityId: req.shift.id, summary: `${req.user.name} changed a schedule entry for ${updated.user_name}` });
  await tellPerson(req, updated.user_id, `Your schedule changed: ${rangeLabel(updated)}`, updated.start_at.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' }));
  setFlash(req, 'success', 'Schedule updated.');
  res.redirect(303, `/portal/schedule?week=${marylandParts(updated.start_at).date}`);
});

router.post('/:id/delete', requirePermission('schedule.edit'), async (req, res) => {
  const s = req.shift;
  await schedule.remove(s.id);
  await audit(req, { action: 'shift.delete', entityType: 'shift', entityId: s.id, summary: `${req.user.name} removed a schedule entry for ${s.user_name}` });
  await tellPerson(req, s.user_id, 'Removed from your schedule', `${rangeLabel(s)} on ${s.start_at.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'long', month: 'short', day: 'numeric' })}`);
  setFlash(req, 'success', 'Removed from the schedule.');
  res.redirect(303, `/portal/schedule?week=${marylandParts(s.start_at).date}`);
});

module.exports = router;
