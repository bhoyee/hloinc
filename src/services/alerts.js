'use strict';

/**
 * Who is told (the bell in the portal) when something new comes in from the
 * website, and when something has waited too long. Seeing an item is a
 * permission; being told about it is chosen here, per role, under Roles &
 * permissions. A role can only be told about what it can see, and if nobody
 * active has a chosen role, Admin is told instead so nothing is missed.
 *
 * Team emails don't come from here: each form emails its team mailbox (set
 * under Website content). "Waiting too long" alerts are also emailed to the
 * people told, without any client details.
 */

const db = require('../db/knex');
const config = require('../config');
const { ADMIN_ROLE, inboxPermission } = require('../auth/permissions');
const { recipients } = require('../lib/site');
const roles = require('./roles');
const content = require('./content');
const notifications = require('./notifications');

const SETTING = 'alerts.routing';

const seesInbox = (key) => (role) => role.permissions.has('messages.view') || role.permissions.has(inboxPermission(key));

/** Everything someone can be alerted about, in the order shown on the Roles page. */
const EVENTS = [
  { key: 'referral', label: 'New referral', help: 'Make a referral form', sees: seesInbox('intake'), defaults: ['intake_specialist'] },
  { key: 'request', label: 'New service request', help: 'Request services form', sees: seesInbox('intake'), defaults: ['intake_specialist'] },
  { key: 'appointment', label: 'New appointment request', help: 'Request an appointment form', sees: (r) => r.permissions.has('appointments.view'), defaults: ['reception', 'intake_specialist'] },
  ...recipients.map((r) => ({
    key: `message_${r.key}`,
    label: `Contact form: ${r.label}`,
    help: 'Contact page',
    sees: seesInbox(r.key),
    defaults: { general: ['reception'], program_coordinator: ['program_coordinator'], program_director: ['program_director'], executive: [ADMIN_ROLE], intake: ['intake_specialist'] }[r.key] || [ADMIN_ROLE],
  })),
  { key: 'application', label: 'New job application', help: 'Apply form on each job (careers page)', sees: (r) => r.permissions.has('jobs.applications'), defaults: [ADMIN_ROLE] },
  {
    key: 'overdue',
    label: 'Waiting too long',
    help: 'Still New after 2 business days (appointment requests: 1). Also emailed.',
    sees: (r) => r.permissions.has('messages.view') || r.permissions.has('appointments.view'),
    defaults: [ADMIN_ROLE],
  },
];
const EVENT = Object.fromEntries(EVENTS.map((e) => [e.key, e]));

/** { eventKey: [roleKeys] } — saved choices, or the defaults, limited to roles that can see the item. */
async function routing() {
  const saved = (await content.getSetting(SETTING, {})) || {};
  const all = await roles.list();
  return Object.fromEntries(EVENTS.map((e) => {
    const chosen = Array.isArray(saved[e.key]) ? saved[e.key] : e.defaults;
    return [e.key, all.filter((r) => chosen.includes(r.key) && e.sees(r)).map((r) => r.key)];
  }));
}

/** The grid for the Roles page: one row per event, one cell per role. */
async function grid() {
  const all = await roles.list();
  const current = await routing();
  return {
    roles: all.map((r) => ({ key: r.key, name: r.name })),
    rows: EVENTS.map((e) => ({
      key: e.key,
      label: e.label,
      help: e.help,
      cells: all.map((r) => ({ role: r.key, eligible: e.sees(r), on: current[e.key].includes(r.key) })),
    })),
  };
}

/** Save the grid from the Roles page form (fields `alert_<event>`). Returns what changed. */
async function save(body, user) {
  const before = await routing();
  const all = await roles.list();
  const value = Object.fromEntries(EVENTS.map((e) => {
    const picked = [].concat(body[`alert_${e.key}`] || []).filter((k) => typeof k === 'string');
    return [e.key, all.filter((r) => picked.includes(r.key) && e.sees(r)).map((r) => r.key)];
  }));
  await db('site_settings').insert({ key: SETTING, value: JSON.stringify(value), updated_by: user.id, updated_at: new Date() }).onConflict('key').merge();
  content.clearCache();
  return EVENTS.filter((e) => before[e.key].join() !== value[e.key].join()).map((e) => ({ event: e.label, from: before[e.key], to: value[e.key] }));
}

/** Active people to tell about `eventKey` (Admin if the chosen roles have nobody). */
async function peopleFor(eventKey) {
  const keys = (await routing())[eventKey] || [];
  const users = keys.length ? await db('users').whereIn('role', keys).where({ status: 'active' }).select('id', 'name', 'email') : [];
  if (users.length) return users;
  return db('users').where({ role: ADMIN_ROLE, status: 'active' }).select('id', 'name', 'email');
}

/** Tell the right people about something new. Never throws. */
async function send(eventKey, payload) {
  if (!EVENT[eventKey]) throw new Error(`Unknown alert: ${eventKey}`);
  try {
    const people = await peopleFor(eventKey);
    await Promise.all(people.map((p) => notifications.notifyUser(p.id, payload)));
    return people;
  } catch (err) {
    console.error('Alert failed:', err.message);
    return [];
  }
}

// --- Waiting too long ------------------------------------------------------------------------

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;

/**
 * Flag items still waiting past the "Needs attention" limits, once each:
 * one bell alert and one short email (no client details) to the people chosen
 * for "Waiting too long". Returns how many items were flagged.
 */
async function checkOverdue(now = new Date()) {
  const { businessDaysBefore, WAIT } = require('./workday');
  const msgs = await db('contact_messages').where({ status: 'new' }).whereNull('archived_at').whereNull('escalated_at')
    .where('created_at', '<', businessDaysBefore(now, WAIT.inbox)).select('id', 'type');
  const appts = await db('appointments').where({ status: 'requested' }).whereNull('escalated_at')
    .where('created_at', '<', businessDaysBefore(now, WAIT.appointmentRequest)).pluck('id');
  if (!msgs.length && !appts.length) return 0;
  if (msgs.length) await db('contact_messages').whereIn('id', msgs.map((m) => m.id)).update({ escalated_at: now });
  if (appts.length) await db('appointments').whereIn('id', appts).update({ escalated_at: now });

  const count = (type) => msgs.filter((m) => m.type === type).length;
  const lines = [
    [count('referral'), 'referral', 'referrals'],
    [count('request'), 'service request', 'service requests'],
    [count('message'), 'contact form message', 'contact form messages'],
    [appts.length, 'appointment request', 'appointment requests'],
  ].filter(([n]) => n).map(([n, one, many]) => plural(n, one, many));
  const total = msgs.length + appts.length;
  const title = `${plural(total, 'item has', 'items have')} waited too long`;
  const body = `${lines.join(', ')} still waiting for someone to pick ${total === 1 ? 'it' : 'them'} up.`;

  const people = await send('overdue', { type: 'overdue', title, body, link: '/portal' });
  const { notify } = require('./notify');
  await Promise.all(people.filter((p) => p.email).map((p) => notify({
    to: p.email,
    subject: `HLO portal: ${title}`,
    text: [
      `Hello ${p.name.split(' ')[0]},`,
      '',
      'These came in from the website and nobody has picked them up yet:',
      '',
      ...lines.map((l) => `- ${l}`),
      '',
      'Messages count as waiting after 2 business days still marked New; appointment requests after 1 business day.',
      'You can see them under “Needs attention” on the dashboard.',
    ].join('\n'),
    cta: { label: 'Open the dashboard', href: `${config.appUrl}/portal` },
    footnote: 'Sent by the HLO staff portal because your role is told about items that wait too long (Roles & permissions).',
  })));
  return total;
}

/** Check every 15 minutes while the app is running (not in tests). */
function startOverdueChecks() {
  if (config.env === 'test') return;
  const run = () => checkOverdue().catch((err) => console.error('Overdue check failed:', err.message));
  setTimeout(run, 60 * 1000).unref();
  setInterval(run, 15 * 60 * 1000).unref();
}

module.exports = { EVENTS, routing, grid, save, peopleFor, send, checkOverdue, startOverdueChecks };
