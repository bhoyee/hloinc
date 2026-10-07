'use strict';

const db = require('../db/knex');
const { marylandDateTime, addDaysIso } = require('../lib/hours');

const KIND_LABELS = { shift: 'Shift', time_off: 'Time off' };

function base() {
  return db('shifts as s').join('users as u', 'u.id', 's.user_id').select('s.*', 'u.name as user_name');
}

/** Shifts that overlap [from, to), optionally for one person. */
function between(from, to, userId) {
  const q = base().where('s.start_at', '<', to).where('s.end_at', '>', from).orderBy('s.start_at');
  if (userId) q.where('s.user_id', userId);
  return q;
}

const get = (id) => base().where('s.id', id).first();

/** Active staff for the team grid and pickers. */
const staff = () => db('users').select('id', 'name', 'role').where({ status: 'active' }).orderBy('name');

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

module.exports = { KIND_LABELS, between, get, staff, toRange, clashes, create, update, remove };
