'use strict';

/**
 * DEMO history so the dashboard charts, inbox and leads behave as they will
 * with real use: about three months of appointments, referrals, service
 * requests and website messages, with staff replies at realistic delays, plus
 * two weeks of staff sign-ins.
 *
 * Development, or a server with DEMO_DATA=true (src/db/demo.js). Runs once.
 * Everything is made up: @example.com emails and 555-01xx phone numbers.
 */
const { make } = require('../../lib/reference');
const { marylandDateTime, marylandParts, addDaysIso } = require('../../lib/hours');
const demo = require('../demo');

const SERVICES = [
  ['respite-care', 5], ['community-residential-services', 4], ['personal-supports', 4],
  ['community-development-services', 3], ['supported-living', 2], ['employment-services', 2],
];
const COUNTIES = [
  ['Baltimore County', 6], ['Howard County', 4], ['Anne Arundel County', 3], ['Baltimore City', 3],
  ['Prince George’s County', 2], ['Montgomery County', 2], ['Harford County', 1], ['Charles County', 1],
];

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  if (await knex('contact_messages').where('email', 'like', `demo.%${demo.VISITOR_DOMAIN}`).first()) return;

  const types = await knex('appointment_types').where({ active: true }).orderBy('sort_order');
  if (!types.length) return;
  const staff = await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).where({ status: 'active' }).select('id', 'name', 'role');
  const intakeTeam = staff.filter((u) => ['intake_specialist', 'program_coordinator', 'program_director'].includes(u.role));

  const rand = demo.random(7);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const weighted = (list) => {
    const total = list.reduce((n, [, w]) => n + w, 0);
    let r = rand() * total;
    for (const [v, w] of list) if ((r -= w) < 0) return v;
    return list[0][0];
  };
  const first = ['Avery', 'Jordan', 'Morgan', 'Riley', 'Casey', 'Quinn', 'Jamie', 'Drew', 'Reese', 'Skyler', 'Rowan', 'Emerson', 'Hayden', 'Parker'];
  const last = ['Example', 'Sample', 'Demo', 'Tester', 'Placeholder', 'Specimen'];
  const person = () => `${pick(first)} ${pick(last)}`;
  const initials = () => `${pick('ABCDEJKLMRST'.split(''))}.${pick('ABCDEGHMNPRSTW'.split(''))}.`;
  const agencies = ['Example Coordination Agency', 'Sample CCS Group', 'Demo Family Supports', 'Placeholder Case Management'];

  // Office-hours delay before the first response: mostly same day, sometimes longer.
  const responseDelayMs = () => {
    const r = rand();
    const hours = r < 0.45 ? 0.5 + rand() * 3 : r < 0.8 ? 4 + rand() * 20 : 24 + rand() * 50;
    return hours * 3600000;
  };

  const today = marylandParts(new Date()).date;
  const appointments = [];
  const intake = [];
  let seq = 0;

  for (let daysAgo = 90; daysAgo >= 0; daysAgo--) {
    const day = addDaysIso(today, -daysAgo);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    const weekend = dow === 0 || dow === 6;

    // Past appointments (weekdays): busier in recent weeks.
    if (!weekend && daysAgo >= 1) {
      const perDay = Math.floor(rand() * (daysAgo < 30 ? 3 : 2.2));
      for (let i = 0; i < perDay; i++) {
        const at = marylandDateTime(day, pick(['09:30', '10:00', '11:00', '13:30', '14:00', '15:30']));
        const roll = rand();
        const status = roll < 0.74 ? 'completed' : roll < 0.86 ? 'no_show' : 'cancelled';
        const source = pick(['website', 'website', 'website', 'phone', 'phone', 'walk_in']);
        const type = pick(types);
        const created = new Date(at.getTime() - Math.floor(rand() * 6 + 1) * 86400000);
        seq += 1;
        appointments.push({
          reference: make('appointment'),
          type_id: type.id,
          source,
          status,
          name: person(),
          email: source === 'website' ? `demo.appt${seq}${demo.VISITOR_DOMAIN}` : null,
          phone: source === 'website' ? null : demo.phone(seq),
          preferred_contact: source === 'website' ? 'email' : 'phone',
          scheduled_at: at,
          duration_minutes: type.duration_minutes,
          assigned_to: intakeTeam.length ? pick(intakeTeam).id : null,
          cancel_reason: status === 'cancelled' ? 'Visitor asked to cancel' : null,
          staff_notes: demo.MARK,
          created_at: created,
          updated_at: created,
        });
      }
    }

    // Website enquiries (any day; fewer at weekends).
    for (const [type, chance] of [['request', 0.45], ['referral', 0.4], ['message', 0.35]]) {
      if (rand() > chance * (weekend ? 0.35 : 1)) continue;
      const at = marylandDateTime(day, pick(['08:15', '09:40', '11:20', '12:40', '14:10', '16:05', '19:20']));
      if (at > new Date()) continue;
      seq += 1;
      const services = [weighted(SERVICES), ...(rand() < 0.3 ? [weighted(SERVICES)] : [])];
      const county = weighted(COUNTIES);
      const name = person();
      const email = `demo.${type}${seq}${demo.VISITOR_DOMAIN}`;
      let row;
      if (type === 'referral') {
        row = {
          recipient: 'intake', name: `${pick(first)} ${pick(['Coordinator', 'Case-Manager', 'Advocate'])}`, email, phone: demo.phone(seq),
          message: rand() < 0.5 ? 'Family is hoping to start before the end of the year.' : '(No additional information)',
          details: { referrer_role: pick(['ccs', 'ccs', 'family', 'school', 'other']), organization: pick(agencies), person_name: initials(), county,
            living_situation: pick(['family_home', 'family_home', 'own_home', 'other_provider']), dda_eligibility: pick(['eligible', 'eligible', 'in_progress', 'not_sure']),
            priority_category: pick(['cp', 'cr', 'other', 'not_sure']), pcp: pick(['completed', 'in_progress', 'not_started']), services: [...new Set(services)],
            timeline: pick(['asap', '30_days', '1_3_months', 'planning']) },
        };
      } else if (type === 'request') {
        const [fn, ln] = name.split(' ');
        row = {
          recipient: 'intake', name, email, phone: demo.phone(seq),
          message: rand() < 0.5 ? 'Looking at options for next year.' : '(No message)',
          details: { first_name: fn, last_name: ln, preferred_contact: pick(['phone', 'email']), best_time: pick(['any', 'morning', 'afternoon']),
            relationship: pick(['family', 'family', 'self', 'guardian']), individual_first_name: pick(first), county,
            dda_eligibility: pick(['eligible', 'in_progress', 'not_sure']), pcp: pick(['completed', 'in_progress', 'not_sure']), priority_category: '', services: [...new Set(services)] },
        };
      } else {
        row = { recipient: pick(['general', 'general', 'intake', 'program_coordinator']), name, email, phone: rand() < 0.5 ? demo.phone(seq) : null,
          message: pick(['Do you have openings for respite this summer?', 'Can someone call me about residential homes in Howard County?', 'What does the intake process involve?']) };
      }

      // Older items have been handled; the last few days are still in progress or new.
      const handled = daysAgo > 6 || rand() < 0.35;
      const respondedAt = handled ? new Date(at.getTime() + responseDelayMs()) : null;
      const status = !handled ? (rand() < 0.6 ? 'new' : 'in_progress') : daysAgo > 14 ? 'resolved' : pick(['in_progress', 'resolved']);
      intake.push({
        row: {
          reference: make(type), type, ...row, details: row.details ? JSON.stringify(row.details) : null,
          status, email_status: 'sent', assigned_to: handled && intakeTeam.length ? pick(intakeTeam).id : null, created_at: at, updated_at: respondedAt || at,
        },
        respondedAt: respondedAt && respondedAt < new Date() ? respondedAt : null,
      });
    }
  }

  if (appointments.length) await knex.batchInsert('appointments', appointments, 100);

  // Messages one by one, so each gets its first response in the history.
  for (const { row, respondedAt } of intake) {
    const [id] = await knex('contact_messages').insert(row);
    if (respondedAt) {
      const by = intakeTeam.length ? pick(intakeTeam) : null;
      await knex('contact_message_events').insert({ message_id: id, user_id: by ? by.id : null, user_name: by ? by.name : 'Demo staff', kind: rand() < 0.5 ? 'reply' : 'status',
        body: rand() < 0.5 ? 'Thanks for reaching out. I’ll call you this week to talk through the options.' : 'New → In progress', email_status: null, created_at: respondedAt });
    }
  }

  // Two weeks of staff sign-ins for the "Staff sign-ins" chart.
  const signIns = [];
  for (let daysAgo = 13; daysAgo >= 0; daysAgo--) {
    const day = addDaysIso(today, -daysAgo);
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    for (const u of staff) {
      if (dow === 0 || dow === 6 ? rand() > 0.1 : rand() > 0.85) continue;
      const at = marylandDateTime(day, pick(['08:20', '08:45', '09:05', '09:30', '12:50']));
      if (at > new Date()) continue;
      signIns.push({ user_id: u.id, user_name: u.name, action: 'auth.login', entity_type: 'user', entity_id: String(u.id), summary: `${u.name} signed in`, ip: demo.AUDIT_IP, created_at: at });
    }
  }
  if (signIns.length) await knex.batchInsert('audit_log', signIns, 100);
};
