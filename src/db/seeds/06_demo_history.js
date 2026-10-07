'use strict';

/**
 * DEMO history so the dashboard charts have trends to show: about three
 * months of past appointments and website enquiries. Development only, and
 * only once (rows are marked "Demo history"). Names and emails are made up.
 */
const { marylandDateTime, marylandParts, addDaysIso } = require('../../lib/hours');

const MARK = 'Demo history';

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;
  if (await knex('appointments').where({ staff_notes: MARK }).first()) return;

  const types = await knex('appointment_types').where({ active: true }).orderBy('sort_order');
  if (!types.length) return;

  // Repeatable "random" numbers, so every developer sees the same charts.
  let n = 7;
  const rand = () => ((n = (n * 9301 + 49297) % 233280) / 233280);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const first = ['Avery', 'Jordan', 'Morgan', 'Riley', 'Casey', 'Quinn', 'Jamie', 'Drew', 'Reese', 'Skyler'];
  const last = ['Example', 'Sample', 'Demo', 'Tester', 'Placeholder'];
  const person = () => `${pick(first)} ${pick(last)}`;

  const today = marylandParts(new Date()).date;
  const appointments = [];
  const messages = [];

  for (let daysAgo = 90; daysAgo >= 1; daysAgo--) {
    const day = addDaysIso(today, -daysAgo);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (dow === 0 || dow === 6) continue;

    // Appointments: busier in recent weeks.
    const perDay = Math.floor(rand() * (daysAgo < 30 ? 3 : 2.2));
    for (let i = 0; i < perDay; i++) {
      const at = marylandDateTime(day, pick(['09:30', '10:00', '11:00', '13:30', '14:00', '15:30']));
      const roll = rand();
      const status = roll < 0.74 ? 'completed' : roll < 0.86 ? 'no_show' : 'cancelled';
      const source = pick(['website', 'website', 'website', 'phone', 'phone', 'walk_in']);
      const type = pick(types);
      const created = new Date(at.getTime() - Math.floor(rand() * 6 + 1) * 86400000);
      appointments.push({
        type_id: type.id,
        source,
        status,
        name: person(),
        email: source === 'website' ? `demo${appointments.length}@example.com` : null,
        phone: source === 'website' ? null : '410-555-0100',
        preferred_contact: source === 'website' ? 'email' : 'phone',
        scheduled_at: at,
        duration_minutes: type.duration_minutes,
        cancel_reason: status === 'cancelled' ? 'Visitor asked to cancel' : null,
        staff_notes: MARK,
        created_at: created,
        updated_at: created,
      });
    }

    // Website messages and referrals (already handled, so the inbox tiles stay realistic).
    for (const [type, chance] of [['message', 0.55], ['referral', 0.3]]) {
      if (rand() < chance) {
        const at = marylandDateTime(day, pick(['08:15', '12:40', '16:05', '19:20']));
        messages.push({
          type,
          recipient: type === 'referral' ? 'intake' : pick(['general', 'intake', 'program_coordinator']),
          name: person(),
          email: `demo.msg${messages.length}@example.com`,
          message: `${MARK}: sample ${type} for the dashboard charts.`,
          status: 'resolved',
          email_status: 'sent',
          created_at: at,
          updated_at: at,
        });
      }
    }
  }

  if (appointments.length) await knex.batchInsert('appointments', appointments, 100);
  if (messages.length) await knex.batchInsert('contact_messages', messages, 100);
};
