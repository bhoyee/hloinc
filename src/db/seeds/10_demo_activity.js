'use strict';

/**
 * DEMO activity for the dashboard's "Recent activity": a realistic mix of what
 * staff do (replies, confirmations, stage changes, posts...), not just sign-ins.
 * Topped up on each deploy so the last day always has some. Marked like the
 * demo sign-ins (ip "demo-seed"), so `npm run demo:remove` deletes it.
 * Development, or a server with DEMO_DATA=true (src/db/demo.js).
 */
const demo = require('../demo');

const EVENTS = [
  ['message.reply', (u) => `${u} emailed a reply to Robin Example (HLO-REQ-7K3M9P)`],
  ['message.status', (u) => `${u} marked referral HLO-REF-4SAKRN as in progress`],
  ['message.assign', (u) => `${u} assigned request HLO-REQ-Q2W8ZT to Indira Intake`],
  ['appointment.confirm', (u) => `${u} confirmed appointment HLO-APT-9NVJR7 for Tue, Oct 13 · 10:00 a.m.`],
  ['appointment.log', (u) => `${u} logged a walk-in appointment (HLO-APT-KX4MPD, Office visit)`],
  ['lead.stage', (u) => `${u} moved lead J.E. to Intake in progress`],
  ['lead.owner', (u) => `${u} assigned lead Sam Caller to Casey Coordinator`],
  ['lead.note', (u) => `${u} added a note to lead Riley Family`],
  ['shift.create', (u) => `${u} added a shift for Jordan Rivera (Residential support)`],
  ['announcement.create', (u) => `${u} posted the announcement “New intake checklist” (staff only)`],
  ['content.publish', (u) => `${u} published changes to the Services page`],
  ['job.update', (u) => `${u} updated the job “Direct Support Professional (DSP)”`],
];

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  const staff = await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).where('email', 'not like', 'team.%').where({ status: 'active' }).select('id', 'name');
  if (!staff.length) return;
  // Already some demo activity in the last 12 hours: nothing to do.
  const since = new Date(Date.now() - 12 * 3600000);
  if (await knex('audit_log').where({ ip: demo.AUDIT_IP }).whereNot({ action: 'auth.login' }).where('created_at', '>', since).first()) return;

  const rand = demo.random(Math.floor(Date.now() / 3600000) % 233280);
  const rows = [];
  for (let i = 0; i < 24; i++) {
    const u = staff[Math.floor(rand() * staff.length)];
    const [action, text] = EVENTS[Math.floor(rand() * EVENTS.length)];
    const at = new Date(Date.now() - Math.floor(rand() * 30 * 3600000) - 60000);
    rows.push({ user_id: u.id, user_name: u.name, action, entity_type: action.split('.')[0], summary: text(u.name), ip: demo.AUDIT_IP, created_at: at });
  }
  rows.sort((a, b) => a.created_at - b.created_at); // ids follow time, like real entries
  await knex.batchInsert('audit_log', rows, 50);
};
