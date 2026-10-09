'use strict';

const db = require('../db/knex');
const { marylandDateTime, addDaysIso } = require('../lib/hours');

const KIND_LABELS = { shift: 'Shift', time_off: 'Time off' };

function base() {
  return db('shifts as s').join('users as u', 'u.id', 's.user_id').select('s.*', 'u.name as user_name');
}

/** Shifts that overlap [from, to), for one person or a list of people (null = everyone). */
function between(from, to, who) {
  const q = base().where('s.start_at', '<', to).where('s.end_at', '>', from).orderBy('s.start_at');
  if (Array.isArray(who)) q.whereIn('s.user_id', who.length ? who : [0]);
  else if (who) q.where('s.user_id', who);
  return q;
}

/**
 * Whose schedules this person can see (set per role under Roles & permissions):
 * null means everyone; otherwise a list of user IDs that always includes their own.
 */
async function visibleIds(user) {
  const scope = user.scheduleScope || { mode: 'own', roles: [] };
  if (scope.mode === 'all') return null;
  if (scope.mode === 'roles' && scope.roles.length) {
    const ids = await db('users').whereIn('role', scope.roles).pluck('id');
    return [...new Set([user.id, ...ids])];
  }
  return [user.id];
}

/** Can this person see (and, with schedule.edit, change) this staff member's schedule? */
async function canSee(user, userId) {
  const ids = await visibleIds(user);
  return ids === null || ids.includes(Number(userId));
}

const get = (id) => base().where('s.id', id).first();

/** Active staff for the team grid and pickers, limited to the people this user can see. */
async function staff(user) {
  const q = db('users').select('id', 'name', 'role').where({ status: 'active' }).orderBy('name');
  if (user) {
    const ids = await visibleIds(user);
    if (ids) q.whereIn('id', ids);
  }
  return q;
}

/**
 * Turn a form's date + start/end times into instants. An end time at or
 * before the start (e.g. 22:00–08:00) means an overnight shift ending the
 * next day. "All day" covers midnight to midnight.
 */
function toRange({ date, start_time: startTime, end_time: endTime, all_day: allDay }) {
  if (allDay === 'yes') return { start: marylandDateTime(date, '00:00'), end: marylandDateTime(addDaysIso(date, 1), '00:00') };
  const start = marylandDateTime(date, startTime);
  const endDate = endTime <= startTime ? addDaysIso(date, 1) : date;
  return { start, end: marylandDateTime(endDate, endTime) };
}

/** Existing entries for the person that overlap [start, end). */
function clashes(userId, start, end, excludeId) {
  const q = db('shifts').where({ user_id: userId }).where('start_at', '<', end).where('end_at', '>', start);
  if (excludeId) q.whereNot({ id: excludeId });
  return q;
}

/**
 * Create a shift, optionally repeating weekly. Weeks that would clash with an
 * existing entry are skipped and reported back.
 */
async function create(data, { repeatWeeks = 1, createdBy }) {
  const created = [];
  const skipped = [];
  for (let i = 0; i < repeatWeeks; i++) {
    const range = toRange({ ...data, date: addDaysIso(data.date, i * 7) });
    if ((await clashes(data.user_id, range.start, range.end)).length) {
      skipped.push(range.start);
      continue;
    }
    const [id] = await db('shifts').insert({
      user_id: data.user_id,
      kind: data.kind,
      start_at: range.start,
      end_at: range.end,
      label: data.label || null,
      location: data.location || null,
      notes: data.notes || null,
      created_by: createdBy,
    });
    created.push(id);
  }
  return { created, skipped };
}

async function update(id, data) {
  const range = toRange(data);
  await db('shifts')
    .where({ id })
    .update({ user_id: data.user_id, kind: data.kind, start_at: range.start, end_at: range.end, label: data.label || null, location: data.location || null, notes: data.notes || null });
  return get(id);
}

const remove = (id) => db('shifts').where({ id }).del();

module.exports = { KIND_LABELS, between, get, staff, visibleIds, canSee, toRange, clashes, create, update, remove };
