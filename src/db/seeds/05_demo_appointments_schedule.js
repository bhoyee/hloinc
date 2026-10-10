'use strict';

/**
 * DEMO appointments so the calendar has something
 * to show. Development, or a server with DEMO_DATA=true (src/db/demo.js).
 * Runs once (rows are marked "Demo data").
 * Visitor names and emails are made up (example.com / .test).
 */
const { make } = require('../../lib/reference');
const demo = require('../demo');
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso } = require('../../lib/hours');

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  if (await knex('appointments').where({ staff_notes: demo.MARK }).whereNull('scheduled_at').first()) return;

  const types = await knex('appointment_types').where({ active: true }).orderBy('sort_order');
  if (!types.length) return;
  const staff = Object.fromEntries((await knex('users').where('email', 'like', '%@hloinc.test').select('email', 'id')).map((u) => [u.email.split('@')[0], u.id]));

  const today = marylandParts(new Date()).date;
  const monday = weekStartIso(today);
  const day = (n) => addDaysIso(monday, n);
  const [intake, office] = [types[0], types[1] || types[0]];

  const rows = [
    // Website requests waiting to be scheduled
    { type_id: intake.id, source: 'website', status: 'requested', name: 'Jordan Example', email: 'jordan@example.com', phone: '410-555-0141', requested_date: day(8), requested_window: 'morning', notes: 'Would like to learn about personal supports for my brother.', created_at: new Date(Date.now() - 4 * 86400000) },
    { type_id: intake.id, source: 'website', status: 'requested', name: 'Morgan Sample', email: 'morgan@example.com', phone: null, requested_date: day(9), requested_window: 'afternoon' },
    { type_id: office.id, source: 'website', status: 'requested', name: 'Taylor Demo', email: 'taylor@example.com', phone: '443-555-0120', preferred_contact: 'phone', requested_date: day(10), requested_window: 'morning' },
    // This week's bookings
    { type_id: intake.id, source: 'website', status: 'confirmed', name: 'Alex Visitor', email: 'alex@example.com', scheduled_at: marylandDateTime(day(1), '10:00'), duration_minutes: intake.duration_minutes, assigned_to: staff.intake || null },
    { type_id: office.id, source: 'phone', status: 'confirmed', name: 'Sam Caller', phone: '410-555-0177', preferred_contact: 'phone', scheduled_at: marylandDateTime(day(2), '13:30'), duration_minutes: office.duration_minutes, assigned_to: staff.coordinator || null },
    { type_id: intake.id, source: 'website', status: 'confirmed', name: 'Riley Family', email: 'riley.family@example.com', scheduled_at: marylandDateTime(day(3), '11:00'), duration_minutes: intake.duration_minutes, assigned_to: staff.intake || null },
    { type_id: office.id, source: 'walk_in', status: 'completed', name: 'Pat Walkin', phone: '410-555-0102', preferred_contact: 'phone', scheduled_at: marylandDateTime(day(0), '09:30'), duration_minutes: office.duration_minutes },
    { type_id: intake.id, source: 'phone', status: 'confirmed', name: 'Drew Today', phone: '410-555-0161', preferred_contact: 'phone', scheduled_at: marylandDateTime(today, '15:00'), duration_minutes: intake.duration_minutes, assigned_to: staff.intake || null },
    { type_id: office.id, source: 'website', status: 'confirmed', name: 'Quinn Today', email: 'quinn.today@example.com', scheduled_at: marylandDateTime(today, '16:30'), duration_minutes: office.duration_minutes, assigned_to: staff.coordinator || null },
    { type_id: office.id, source: 'website', status: 'confirmed', name: 'Casey Nextweek', email: 'casey.n@example.com', scheduled_at: marylandDateTime(day(7), '15:00'), duration_minutes: office.duration_minutes },
  ];
  await knex('appointments').insert(rows.map((r) => ({ ...r, staff_notes: demo.MARK, reference: make('appointment') })));

  // Demo shifts are kept topped up by 09_demo_team_schedule.js.
};
