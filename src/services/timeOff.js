'use strict';

/**
 * Time-off requests. Anyone can ask for time off for themselves. The people
 * whose role can "Receive & approve time-off requests" (Admin only, unless the
 * Admin gives it to other roles under Roles & permissions), within that role's
 * schedule visibility, are told by in-app notification and email, and approve
 * or decline. Approving adds the time off to the schedule. The
 * requester hears back the same two ways.
 */

const db = require('../db/knex');
const config = require('../config');
const { can, ADMIN_ROLE } = require('../auth/permissions');
const { marylandDateTime, marylandParts, addDaysIso } = require('../lib/hours');
const schedule = require('./schedule');
const roles = require('./roles');
const notifications = require('./notifications');
const { notify } = require('./notify');

const REASONS = { vacation: 'Vacation / annual leave', sick: 'Sick', personal: 'Personal', training: 'Training', other: 'Other' };
const STATUS_LABELS = { pending: 'Pending', approved: 'Approved', declined: 'Declined', cancelled: 'Cancelled' };

const fmtDay = (d) => new Date(d).toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
const fmtTime = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

/** "Mon, Oct 12 – Wed, Oct 14 (3 days)" or "Tue, Oct 13, 1:00 PM – 5:00 PM". */
function describe(r) {
  if (r.all_day) {
    const lastDay = new Date(new Date(r.end_at).getTime() - 1);
    const days = Math.round((new Date(r.end_at) - new Date(r.start_at)) / 86400000);
    return marylandParts(r.start_at).date === marylandParts(lastDay).date
      ? `${fmtDay(r.start_at)} (all day)`
      : `${fmtDay(r.start_at)} – ${fmtDay(lastDay)} (${days} days)`;
  }
  return `${fmtDay(r.start_at)}, ${fmtTime(r.start_at)} – ${fmtTime(r.end_at)}`;
}

/** Start and end instants from the form (whole days, or hours on one day). */
function toRange({ start_date: startDate, end_date: endDate, all_day: allDay, start_time: startTime, end_time: endTime }) {
  if (allDay) return { start: marylandDateTime(startDate, '00:00'), end: marylandDateTime(addDaysIso(endDate || startDate, 1), '00:00'), allDay: true };
  return { start: marylandDateTime(startDate, startTime), end: marylandDateTime(startDate, endTime), allDay: false };
}

/** A staff member as permission checks expect (role permissions and schedule scope attached). */
async function asStaff(row) {
  const role = await roles.get(row.role);
  return { ...row, status: row.status || 'active', permissions: role ? role.permissions : new Set(), scheduleScope: role ? role.scheduleScope : { mode: 'own', roles: [] } };
}

/** Can this person approve or decline requests from `requesterId`? (Never their own, unless Admin.) */
const APPROVE = 'schedule.approve_time_off';

async function canDecide(user, requesterId) {
  if (!can(user, APPROVE)) return false;
  if (user.id === requesterId && user.role !== ADMIN_ROLE) return false;
  return schedule.canSee(user, requesterId);
}

/** Everyone who should be told about a request from `requester`. */
async function approversFor(requester) {
  const keys = (await roles.list()).filter((r) => r.permissions.has(APPROVE)).map((r) => r.key);
  if (!keys.length) return [];
  const candidates = await db('users').whereIn('role', keys).where({ status: 'active' }).whereNot({ id: requester.id }).select('id', 'name', 'email', 'role');
  const out = [];
  for (const c of candidates) if (await canDecide(await asStaff(c), requester.id)) out.push(c);
  return out;
}

function base() {
  return db('time_off_requests as r').join('users as u', 'u.id', 'r.user_id')
    .select('r.*', 'u.name as user_name', 'u.email as user_email', 'u.role as user_role');
}

/** People whose requests this person may see as a manager (null = everyone). */
async function managedIds(user) {
  if (!can(user, APPROVE)) return [];
  return schedule.visibleIds(user);
}

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

const TABS = {
  pending: { label: 'Pending', manager: true },
  mine: { label: 'My requests', manager: false },
  all: { label: 'All', manager: true },
};

function scoped(query, user, tab, ids) {
  if (tab === 'mine') return query.where('r.user_id', user.id);
  if (ids) query.whereIn('r.user_id', ids.length ? ids : [0]);
  if (user.role !== ADMIN_ROLE) query.whereNot('r.user_id', user.id); // your own are under "My requests"
  if (tab === 'pending') query.where('r.status', 'pending');
  return query;
}

async function tabCounts(user) {
  const ids = await managedIds(user);
  const manager = can(user, APPROVE);
  const count = async (tab) => Number((await scoped(db('time_off_requests as r'), user, tab, ids).count({ n: '*' }).first()).n);
  return { pending: manager ? await count('pending') : null, mine: await count('mine'), all: manager ? await count('all') : null };
}

async function list(user, { tab = 'mine', q = '', page = 1, perPage = 25 } = {}) {
  const ids = await managedIds(user);
  const query = scoped(base(), user, tab, ids);
  if (q && tab !== 'mine') query.where((w) => w.where('u.name', 'like', likeOf(q)).orWhere('r.notes', 'like', likeOf(q)));
  const total = Number((await query.clone().clearSelect().count({ n: '*' }).first()).n);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number(page) || 1), pages);
  const items = await query
    .orderByRaw("FIELD(r.status, 'pending', 'approved', 'declined', 'cancelled')")
    .orderBy('r.start_at', tab === 'pending' ? 'asc' : 'desc')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { items: items.map((r) => ({ ...r, when: describe(r) })), total, page: current, pages };
}

/** One request, if this person may see it (theirs, or one they manage). */
async function getFor(user, id) {
  const r = await base().where('r.id', id).first();
  if (!r) return null;
  if (r.user_id !== user.id) {
    const ids = await managedIds(user);
    if (ids !== null && !ids.includes(r.user_id)) return null;
  }
  return { ...r, when: describe(r) };
}

/** Shifts the person already has during the request (shown to the manager before approving). */
function clashes(r) {
  return db('shifts').where({ user_id: r.user_id, kind: 'shift' }).where('start_at', '<', r.end_at).where('end_at', '>', r.start_at).orderBy('start_at');
}

// --- Telling people -------------------------------------------------------------------

const portalUrl = (id) => `${config.appUrl}/portal/schedule/time-off/${id}`;

async function tellManagers(r, requester) {
  const approvers = await approversFor(requester);
  const title = `Time-off request from ${requester.name}`;
  const body = `${REASONS[r.reason]} · ${r.when}`;
  await Promise.all(approvers.map((a) => notifications.notifyUser(a.id, { type: 'timeoff', title, body, link: `/portal/schedule/time-off/${r.id}` })));
  await Promise.all(approvers.map((a) => notify({
    to: a.email,
    subject: `${title}: ${r.when}`,
    text: [
      `Hello ${a.name.split(' ')[0]},`,
      '',
      `${requester.name} has asked for time off.`,
      '',
      'THE REQUEST',
      `Reason: ${REASONS[r.reason]}`,
      `When: ${r.when}`,
      ...(r.notes ? [`Note: ${r.notes}`] : []),
      '',
      'Please approve or decline it in the staff portal.',
    ].join('\n'),
    cta: { label: 'Review the request', href: portalUrl(r.id) },
    footnote: 'Sent by the HLO staff portal because your role receives time-off requests.',
  })));
  return approvers.length;
}

async function tellRequester(r, decider) {
  const approved = r.status === 'approved';
  const title = approved ? 'Your time off was approved' : 'Your time-off request was declined';
  const body = `${r.when}${r.decision_note ? ` · “${r.decision_note}”` : ''}`;
  await notifications.notifyUser(r.user_id, { type: 'timeoff', title, body, link: `/portal/schedule/time-off/${r.id}` });
  await notify({
    to: r.user_email,
    subject: `${title}: ${r.when}`,
    text: [
      `Hello ${r.user_name.split(' ')[0]},`,
      '',
      approved ? `${decider.name} approved your time off. It’s now on your schedule.` : `${decider.name} declined your time-off request.`,
      '',
      'YOUR REQUEST',
      `Reason: ${REASONS[r.reason]}`,
      `When: ${r.when}`,
      ...(r.decision_note ? [`${approved ? 'Note' : 'Reason given'}: ${r.decision_note}`] : []),
      '',
      approved ? 'Enjoy your time off.' : 'If you have questions, please speak with your manager.',
    ].join('\n'),
    cta: { label: approved ? 'See my schedule' : 'View the request', href: approved ? `${config.appUrl}/portal/schedule?view=mine` : portalUrl(r.id) },
    footnote: 'Sent by the HLO staff portal.',
  });
}

// --- Actions ----------------------------------------------------------------------------

async function create(user, data) {
  const { start, end, allDay } = toRange(data);
  const [id] = await db('time_off_requests').insert({ user_id: user.id, reason: data.reason, start_at: start, end_at: end, all_day: allDay, notes: data.notes || null });
  const r = await getFor(user, id);
  const told = await tellManagers(r, user);
  return { request: r, told };
}

async function approve(r, decider, note) {
  const [shiftId] = await db('shifts').insert({
    user_id: r.user_id, kind: 'time_off', start_at: r.start_at, end_at: r.end_at,
    label: REASONS[r.reason], notes: r.notes || null, created_by: decider.id,
  });
  await db('time_off_requests').where({ id: r.id }).update({
    status: 'approved', decided_by: decider.id, decided_by_name: decider.name, decided_at: db.fn.now(), decision_note: note || null, shift_id: shiftId, updated_at: db.fn.now(),
  });
  const updated = { ...r, status: 'approved', decision_note: note || null };
  await tellRequester(updated, decider);
  return updated;
}

async function decline(r, decider, note) {
  await db('time_off_requests').where({ id: r.id }).update({
    status: 'declined', decided_by: decider.id, decided_by_name: decider.name, decided_at: db.fn.now(), decision_note: note || null, updated_at: db.fn.now(),
  });
  const updated = { ...r, status: 'declined', decision_note: note || null };
  await tellRequester(updated, decider);
  return updated;
}

const cancel = (r) => db('time_off_requests').where({ id: r.id, status: 'pending' }).update({ status: 'cancelled', updated_at: db.fn.now() });

/** Pending requests this person can decide on (menu counter and dashboard). */
async function pendingFor(user) {
  if (!can(user, APPROVE)) return null;
  const ids = await managedIds(user);
  return Number((await scoped(db('time_off_requests as r'), user, 'pending', ids).count({ n: '*' }).first()).n);
}

module.exports = {
  REASONS, STATUS_LABELS, TABS, describe, toRange, canDecide, approversFor, tabCounts, list, getFor, clashes,
  create, approve, decline, cancel, pendingFor, APPROVE,
};
