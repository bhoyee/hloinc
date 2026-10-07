'use strict';

/**
 * DEMO appointments and shifts so the calendar and schedule have something
 * to show. Development only. Adds nothing if appointments already exist.
 * Visitor names and emails are made up (example.com / .test).
 */
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso } = require('../../lib/hours');

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  if (await knex('appointments').first()) return;

  const types = await knex('appointment_types').where({ active: true }).orderBy('sort_order');
  if (!types.length) return;
  const staff = Object.fromEntries((await knex('users').where('email', 'like', '%@hloinc.test').select('email', 'id')).map((u) => [u.email.split('@')[0], u.id]));

  const today = marylandParts(new Date()).date;
  const monday = weekStartIso(today);
  const day = (n) => addDaysIso(monday, n);
  const [intake, office] = [types[0], types[1] || types[0]];

  const rows = [
    // Website requests waiting to be scheduled
    { type_id: intake.id, source: 'website', status: 'requested', name: 'Jordan Example', email: 'jordan@example.com', phone: '410-555-0141', requested_date: day(8), requested_window: 'morning', notes: 'Would like to learn about personal supports for my brother.' },
    { type_id: intake.id, source: 'website', status: 'requested', name: 'Morgan Sample', email: 'morgan@example.com', phone: null, requested_date: day(9), requested_window: 'afternoon' },
    { type_id: office.id, source: 'website', status: 'requested', name: 'Taylor Demo', email: 'taylor@example.com', phone: '443-555-0120', preferred_contact: 'phone', requested_date: day(10), requested_window: 'morning' },
    // This week's bookings
    { type_id: intake.id, source: 'website', status: 'confirmed', name: 'Alex Visitor', email: 'alex@example.com', scheduled_at: marylandDateTime(day(1), '10:00'), duration_minutes: intake.duration_minutes, assigned_to: staff.intake || null },
    { type_id: office.id, source: 'phone', status: 'confirmed', name: 'Sam Caller', phone: '410-555-0177', preferred_contact: 'phone', scheduled_at: marylandDateTime(day(2), '13:30'), duration_minutes: office.duration_minutes, assigned_to: staff.coordinator || null },
    { type_id: intake.id, source: 'website', status: 'confirmed', name: 'Riley Family', email: 'riley.family@example.com', scheduled_at: marylandDateTime(day(3), '11:00'), duration_minutes: intake.duration_minutes, assigned_to: staff.intake || null },
    { type_id: office.id, source: 'walk_in', status: 'completed', name: 'Pat Walkin', phone: '410-555-0102', preferred_contact: 'phone', scheduled_at: marylandDateTime(day(0), '09:30'), duration_minutes: office.duration_minutes },
    { type_id: office.id, source: 'website', status: 'confirmed', name: 'Casey Nextweek', email: 'casey.n@example.com', scheduled_at: marylandDateTime(day(7), '15:00'), duration_minutes: office.duration_minutes },
  ];
  await knex('appointments').insert(rows);

  // A normal week for the demo staff, plus one overnight shift and some leave.
  const shifts = [];
  const add = (who, d, from, to, extra = {}) => {
    if (!staff[who]) return;
    const end = to <= from ? addDaysIso(d, 1) : d;
    shifts.push({ user_id: staff[who], kind: 'shift', start_at: marylandDateTime(d, from), end_at: marylandDateTime(end, to), ...extra });
  };
  for (let i = 0; i < 5; i++) {
    add('reception', day(i), '09:00', '17:00', { label: 'Front desk', location: 'Catonsville office' });
    add('intake', day(i), i === 4 ? '09:00' : '08:30', i === 4 ? '13:00' : '16:30', { label: 'Intake', location: 'Catonsville office' });
  }
  for (const i of [0, 1, 3]) add('coordinator', day(i), '10:00', '18:00', { label: 'Community visits', location: 'Baltimore County' });
  add('coordinator', day(2), '22:00', '08:00', { label: 'Overnight cover', location: 'Residential home' });
  if (staff.director) {
    shifts.push({ user_id: staff.director, kind: 'time_off', start_at: marylandDateTime(day(4), '00:00'), end_at: marylandDateTime(day(5), '00:00'), label: 'Annual leave' });
  }
  if (shifts.length) await knex('shifts').insert(shifts);
};
