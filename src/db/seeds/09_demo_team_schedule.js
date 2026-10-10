'use strict';

/**
 * DEMO team and schedule: eight extra team members (schedule only; they
 * cannot sign in) and a realistic rota for everyone on the demo team, every
 * day including weekends, from last week to three weeks ahead.
 *
 * Runs on every deploy and only fills in days that have no demo shift yet,
 * so the preview always has a current schedule without duplicates.
 * Development, or a server with DEMO_DATA=true (src/db/demo.js).
 * Demo shifts are the ones with no "created by"; `npm run demo:remove` deletes them.
 */
const crypto = require('crypto');
const bcrypt = require('bcryptjs');
const { marylandDateTime, marylandParts, addDaysIso } = require('../../lib/hours');
const demo = require('../demo');

// Extra people for the schedule. Random passwords nobody knows: they cannot sign in.
const TEAM = [
  ['Jordan Rivera', 'team.jordan', 'program_coordinator'],
  ['Priya Shah', 'team.priya', 'program_coordinator'],
  ['Marcus Bell', 'team.marcus', 'program_coordinator'],
  ['Elena Moreno', 'team.elena', 'intake_specialist'],
  ['Sam Okafor', 'team.sam', 'intake_specialist'],
  ['Grace Kim', 'team.grace', 'reception'],
  ['Tyler Brooks', 'team.tyler', 'reception'],
  ['Nadia Hassan', 'team.nadia', 'program_coordinator'],
];

const OFFICE = 'Catonsville office';

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;

  for (const [name, local, role] of TEAM) {
    const email = `${local}${demo.STAFF_DOMAIN}`;
    if (!(await knex('users').where({ email }).first())) {
      const unusable = await bcrypt.hash(crypto.randomBytes(32).toString('hex'), 10);
      await knex('users').insert({ name, email, role, password_hash: unusable, password_changed_at: knex.fn.now() });
    }
  }

  const people = Object.fromEntries((await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).where({ status: 'active' }).select('email', 'id'))
    .map((u) => [u.email.split('@')[0], u.id]));
  if (!Object.keys(people).length) return;

  const today = marylandParts(new Date()).date;
  const from = addDaysIso(today, -7);
  const to = addDaysIso(today, 21);

  // Days that already have a demo shift for that person.
  const existing = await knex('shifts').whereIn('user_id', Object.values(people)).whereNull('created_by')
    .where('start_at', '>=', marylandDateTime(addDaysIso(from, -1), '00:00')).where('start_at', '<', marylandDateTime(addDaysIso(to, 1), '00:00'))
    .select('user_id', 'start_at');
  const has = new Set(existing.map((s) => `${s.user_id}|${marylandParts(s.start_at).date}`));

  const rows = [];
  const add = (who, day, start, end, label, location, kind = 'shift') => {
    const id = people[who];
    if (!id || has.has(`${id}|${day}`)) return;
    has.add(`${id}|${day}`);
    const endDay = end <= start ? addDaysIso(day, 1) : day;
    rows.push({ user_id: id, kind, start_at: marylandDateTime(day, start), end_at: marylandDateTime(endDay, end), label, location });
  };

  for (let day = from, i = 0; day <= to; day = addDaysIso(day, 1), i++) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;
    const week = Math.floor(i / 7);

    if (!weekend) {
      add('reception', day, '09:00', '17:00', 'Front desk', OFFICE);
      add('team.grace', day, dow === 5 ? '12:00' : '08:00', dow === 5 ? '17:00' : '13:00', 'Front desk', OFFICE);
      add('intake', day, '08:30', '16:30', 'Intake', OFFICE);
      add('team.elena', day, '09:00', '17:00', 'Intake calls', OFFICE);
      if (dow !== 3) add('team.sam', day, '10:00', '18:00', 'Intake visits', 'Howard County');
      if ([1, 2, 4].includes(dow)) add('coordinator', day, '10:00', '18:00', 'Community visits', 'Baltimore County');
      if (dow === 3) add('coordinator', day, '22:00', '08:00', 'Overnight cover', 'Residential home');
      add('team.jordan', day, '07:00', '15:00', 'Residential support', 'Residential home');
      add('team.priya', day, '14:00', '22:00', 'Residential support', 'Residential home');
      if (dow % 2 === 1) add('team.marcus', day, '22:00', '08:00', 'Overnight cover', 'Residential home');
      else add('team.marcus', day, '09:00', '17:00', 'Community visits', 'Anne Arundel County');
      add('team.nadia', day, '11:00', '19:00', 'Day program', 'CDS centre');
      // The director takes a weekday off every other week; otherwise in the office.
      if (week % 2 === 1 && dow === 5) add('director', day, '00:00', '00:00', 'Annual leave', null, 'time_off');
      else add('director', day, '09:00', '17:00', 'Office', OFFICE);
    } else {
      // Weekend cover for the residential homes, plus someone on call.
      add('team.jordan', day, '08:00', '16:00', 'Weekend cover', 'Residential home');
      add('team.priya', day, '16:00', '00:00', 'Weekend cover', 'Residential home');
      add('team.marcus', day, '00:00', '08:00', 'Overnight cover', 'Residential home');
      add('team.tyler', day, '09:00', '13:00', 'Weekend phones', OFFICE);
      add(dow === 6 ? 'director' : 'coordinator', day, '09:00', '17:00', 'On call', 'Remote');
    }
  }
  // "All day" time off runs midnight to midnight.
  for (const r of rows) if (r.kind === 'time_off') r.end_at = new Date(r.start_at.getTime() + 24 * 3600000);
  if (rows.length) await knex.batchInsert('shifts', rows, 100);
};
