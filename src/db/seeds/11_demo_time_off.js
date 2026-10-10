'use strict';

/**
 * DEMO time-off requests: some waiting, some approved (and on the schedule),
 * one declined and one cancelled, so the Time off pages can be tried.
 * Development, or a server with DEMO_DATA=true (src/db/demo.js). Runs once;
 * `npm run demo:remove` deletes them with the demo staff.
 */
const { marylandDateTime, marylandParts, addDaysIso } = require('../../lib/hours');
const demo = require('../demo');

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  const staff = Object.fromEntries((await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).where({ status: 'active' }).select('email', 'id', 'name'))
    .map((u) => [u.email.split('@')[0], u]));
  const ids = Object.values(staff).map((u) => u.id);
  if (!ids.length || (await knex('time_off_requests').whereIn('user_id', ids).first())) return;
  const approver = staff.director || staff.admin;
  if (!approver) return;

  const today = marylandParts(new Date()).date;
  const day = (n) => addDaysIso(today, n);
  const allDay = (from, to) => ({ start_at: marylandDateTime(from, '00:00'), end_at: marylandDateTime(addDaysIso(to, 1), '00:00'), all_day: true });
  const hours = (on, from, to) => ({ start_at: marylandDateTime(on, from), end_at: marylandDateTime(on, to), all_day: false });
  const decided = (status, note) => ({ status, decided_by: approver.id, decided_by_name: approver.name, decided_at: new Date(Date.now() - 86400000), decision_note: note || null });
  const ago = (days) => ({ created_at: new Date(Date.now() - days * 86400000) });

  const rows = [
    // Waiting for a decision.
    staff['team.jordan'] && { user_id: staff['team.jordan'].id, reason: 'vacation', ...allDay(day(9), day(11)), notes: 'Family wedding out of state. Priya has offered to cover my Monday shift.', ...ago(2) },
    staff.intake && { user_id: staff.intake.id, reason: 'sick', ...allDay(day(1), day(1)), notes: 'Doctor’s appointment and recovery.', ...ago(0) },
    staff.coordinator && { user_id: staff.coordinator.id, reason: 'personal', ...hours(day(4), '13:00', '17:00'), notes: null, ...ago(1) },
    // Decided.
    staff['team.priya'] && { user_id: staff['team.priya'].id, reason: 'vacation', ...allDay(day(15), day(19)), notes: 'Annual leave.', ...decided('approved', 'Enjoy the break!'), ...ago(6) },
    staff.reception && { user_id: staff.reception.id, reason: 'training', ...allDay(day(6), day(6)), notes: 'First aid refresher course.', ...decided('approved'), ...ago(5) },
    staff['team.marcus'] && { user_id: staff['team.marcus'].id, reason: 'vacation', ...allDay(day(2), day(3)), notes: null, ...decided('declined', 'We are short on overnight cover that week. Could you pick other dates?'), ...ago(4) },
    staff['team.grace'] && { user_id: staff['team.grace'].id, reason: 'personal', ...hours(day(5), '09:00', '12:00'), notes: null, status: 'cancelled', ...ago(3) },
  ].filter(Boolean);

  for (const r of rows) {
    const [id] = await knex('time_off_requests').insert({ ...r, updated_at: r.created_at });
    if (r.status === 'approved') {
      // On the schedule, like a real approval (no "created by", so demo removal finds it).
      const [shiftId] = await knex('shifts').insert({ user_id: r.user_id, kind: 'time_off', start_at: r.start_at, end_at: r.end_at, label: r.reason === 'training' ? 'Training' : 'Vacation / annual leave', notes: r.notes });
      await knex('time_off_requests').where({ id }).update({ shift_id: shiftId });
    }
  }
};
