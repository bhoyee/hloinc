'use strict';

/**
 * Dashboard panels for managers: what needs attention, what is happening
 * today, and one-click shortcuts. Everything respects the person's
 * permissions and schedule visibility.
 */

const crypto = require('crypto');
const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { marylandParts, marylandDateTime, addDaysIso } = require('../lib/hours');
const schedule = require('./schedule');

/** How long before something counts as waiting too long (business days). */
const WAIT = { inbox: 2, appointmentRequest: 1 };

/** Contact inbox scope for this user: everything, intake only, or nothing. */
function inboxScope(user) {
  if (can(user, 'messages.view')) return (q) => q;
  if (can(user, 'messages.view_intake')) return (q) => q.where('recipient', 'intake');
  return null;
}

/** The moment `n` business days (Mon–Fri, Maryland) before `now`. */
function businessDaysBefore(now, n) {
  const { date, time } = marylandParts(now);
  let d = date;
  let left = n;
  while (left > 0) {
    d = addDaysIso(d, -1);
    const weekday = new Date(`${d}T12:00:00Z`).getUTCDay();
    if (weekday !== 0 && weekday !== 6) left -= 1;
  }
  return marylandDateTime(d, time);
}

const plural = (n, one, many) => `${n} ${n === 1 ? one : many}`;
const count = async (q) => Number((await q.count({ n: '*' }).first()).n);

/** Items that need someone to act, most urgent first. Only lines with something in them. */
async function attention(user, now = new Date()) {
  const items = [];
  const scope = inboxScope(user);
  if (scope) {
    const cutoff = businessDaysBefore(now, WAIT.inbox);
    const waiting = (type) => count(scope(db('contact_messages').where({ type, status: 'new' }).whereNull('archived_at').where('created_at', '<', cutoff)));
    const [referrals, requests, messages] = await Promise.all([waiting('referral'), waiting('request'), waiting('message')]);
    if (referrals) items.push({ key: 'old-referrals', tone: 'red', icon: 'document', title: `${plural(referrals, 'referral', 'referrals')} waiting over ${WAIT.inbox} business days`, detail: 'Still marked New', href: '/portal/messages?tab=new&type=referral' });
    if (requests) items.push({ key: 'old-requests', tone: 'red', icon: 'heart', title: `${plural(requests, 'service request', 'service requests')} waiting over ${WAIT.inbox} business days`, detail: 'Still marked New', href: '/portal/messages?tab=new&type=request' });
    if (messages) items.push({ key: 'old-messages', tone: 'amber', icon: 'mail', title: `${plural(messages, 'website message', 'website messages')} waiting over ${WAIT.inbox} business days`, detail: 'Still marked New', href: '/portal/messages?tab=new&type=message' });

    const unassigned = await count(scope(db('contact_messages').whereIn('status', ['new', 'in_progress']).whereNull('archived_at').whereNull('assigned_to')));
    if (unassigned) items.push({ key: 'unassigned', tone: 'amber', icon: 'users', title: `${plural(unassigned, 'open item has', 'open items have')} nobody assigned`, detail: 'Messages, referrals and requests', href: '/portal/messages?tab=all&unassigned=1' });

    const failed = await count(scope(db('contact_messages').where({ email_status: 'failed' }).whereNot({ status: 'resolved' }).whereNull('archived_at')));
    if (failed) items.push({ key: 'failed-email', tone: 'red', icon: 'exclamation', title: `${plural(failed, 'email', 'emails')} to the team did not send`, detail: 'Saved in the inbox, but nobody was emailed', href: '/portal/messages?tab=all&failed=1' });
  }
  if (can(user, 'appointments.view')) {
    const stale = await count(db('appointments').where({ status: 'requested' }).where('created_at', '<', businessDaysBefore(now, WAIT.appointmentRequest)));
    if (stale) items.push({ key: 'old-appointments', tone: 'red', icon: 'calendar', title: `${plural(stale, 'appointment request', 'appointment requests')} not confirmed after ${WAIT.appointmentRequest} business day`, detail: 'Waiting for a time', href: '/portal/appointments?tab=requests' });
  }
  const waitingTimeOff = await require('./timeOff').pendingFor(user);
  if (waitingTimeOff) items.push({ key: 'time-off', tone: 'amber', icon: 'sun', title: `${plural(waitingTimeOff, 'time-off request', 'time-off requests')} waiting for a decision`, detail: 'Approve or decline', href: '/portal/schedule/time-off?tab=pending' });
  const order = { red: 0, amber: 1 };
  return items.sort((a, b) => order[a.tone] - order[b.tone]);
}

const timeOf = (when) => new Intl.DateTimeFormat('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }).format(new Date(when));

/** Today's confirmed appointments and who is working (or off), for people allowed to see them. */
async function today(user, now = new Date()) {
  const day = marylandParts(now).date;
  const start = marylandDateTime(day, '00:00');
  const end = marylandDateTime(addDaysIso(day, 1), '00:00');
  const out = { date: day, appointments: null, working: null, off: null };

  if (can(user, 'appointments.view')) {
    const rows = await db('appointments as a')
      .leftJoin('appointment_types as t', 't.id', 'a.type_id')
      .leftJoin('users as u', 'u.id', 'a.assigned_to')
      .select('a.id', 'a.name', 'a.scheduled_at', 'a.duration_minutes', 'a.status', 't.name as type_name', 'u.name as assigned_name')
      .whereIn('a.status', ['confirmed', 'completed', 'no_show'])
      .where('a.scheduled_at', '>=', start)
      .where('a.scheduled_at', '<', end)
      .orderBy('a.scheduled_at');
    out.appointments = rows.map((a) => ({
      id: a.id,
      time: timeOf(a.scheduled_at),
      past: new Date(a.scheduled_at).getTime() + (a.duration_minutes || 30) * 60000 < now.getTime(),
      name: a.name,
      type: a.type_name,
      with: a.assigned_name,
      status: a.status,
      href: `/portal/appointments/${a.id}`,
    }));
  }

  if (can(user, 'schedule.view')) {
    const shifts = await schedule.between(start, end, await schedule.visibleIds(user));
    const people = (kind) => {
      const seen = new Map();
      for (const s of shifts.filter((x) => x.kind === kind)) {
        const onNow = new Date(s.start_at) <= now && now < new Date(s.end_at);
        const prev = seen.get(s.user_id);
        // Someone with two shifts today (e.g. the end of last night's): show the one they're on now.
        if (!prev || (onNow && !prev.onNow)) {
          seen.set(s.user_id, { id: s.user_id, name: s.user_name, from: timeOf(s.start_at), until: timeOf(s.end_at), label: s.label, onNow, startsAt: new Date(s.start_at).getTime() });
        }
      }
      return [...seen.values()].sort((a, b) => Number(b.onNow) - Number(a.onNow) || a.startsAt - b.startsAt);
    };
    out.working = people('shift');
    out.onNow = out.working.filter((p) => p.onNow).length;
    out.off = people('time_off');
  }
  return out;
}

const dayHeading = (iso, todayIso) => {
  if (iso === todayIso) return 'Today';
  if (iso === addDaysIso(todayIso, 1)) return 'Tomorrow';
  return new Intl.DateTimeFormat('en-US', { weekday: 'long', month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
};

/**
 * This person's upcoming shifts and time off (next 60 days, up to 60 entries),
 * grouped by day, with a short summary of this week.
 */
async function myShifts(user, now = new Date()) {
  const todayIso = marylandParts(now).date;
  const rows = await db('shifts')
    .where({ user_id: user.id })
    .where('end_at', '>', now)
    .where('start_at', '<', marylandDateTime(addDaysIso(todayIso, 60), '00:00'))
    .orderBy('start_at')
    .limit(60);
  const weekEnd = marylandDateTime(addDaysIso(todayIso, 7 - ((new Date(`${todayIso}T12:00:00Z`).getUTCDay() + 6) % 7)), '00:00'); // next Monday
  let weekCount = 0;
  let weekHours = 0;
  const days = new Map();
  for (const s of rows) {
    const start = new Date(s.start_at);
    const end = new Date(s.end_at);
    const hours = (end - start) / 3600000;
    if (s.kind === 'shift' && start < weekEnd) {
      weekCount += 1;
      weekHours += hours;
    }
    const iso = marylandParts(start < now ? now : start).date;
    if (!days.has(iso)) days.set(iso, { date: iso, heading: dayHeading(iso, todayIso), items: [] });
    days.get(iso).items.push({
      kind: s.kind,
      label: s.kind === 'time_off' ? s.label || 'Time off' : s.label || 'Shift',
      location: s.location,
      from: timeOf(start),
      until: timeOf(end),
      allDay: s.kind === 'time_off' && hours >= 23.9,
      overnight: marylandParts(end).date !== marylandParts(start).date && hours < 23.9,
      onNow: start <= now && now < end,
      hours: Math.round(hours * 10) / 10,
    });
  }
  return { count: rows.length, weekCount, weekHours: Math.round(weekHours * 10) / 10, days: [...days.values()] };
}

/** Recent audit-log entries with an icon for each kind of action and a "time ago". */
const ACTIVITY_ICONS = [
  [/^auth\.|^mfa\./, 'lock'], [/^message/, 'inbox'], [/^appointment/, 'calendar'], [/^lead/, 'heart'],
  [/^announcement/, 'megaphone'], [/^content\./, 'pencil'], [/^shift/, 'clock'], [/^job/, 'briefcase'],
  [/^(account|user|role|invite)/, 'users'], [/^security/, 'shield'],
];
function ago(when, now = new Date()) {
  const mins = Math.round((now - new Date(when)) / 60000);
  if (mins < 1) return 'just now';
  if (mins < 60) return `${mins} min ago`;
  const hrs = Math.round(mins / 60);
  if (hrs < 24) return `${hrs} h ago`;
  const days = Math.round(hrs / 24);
  return days === 1 ? 'yesterday' : `${days} days ago`;
}
async function recentActivity(limit = 30, now = new Date()) {
  const rows = await db('audit_log').select('id', 'action', 'user_name', 'summary', 'created_at').orderBy('id', 'desc').limit(limit);
  return rows.map((e) => ({
    ...e,
    icon: (ACTIVITY_ICONS.find(([re]) => re.test(e.action)) || [null, 'info'])[1],
    tone: /failed|delete|lock/.test(e.action) ? 'red' : /^auth\./.test(e.action) ? 'grey' : 'green',
    ago: ago(e.created_at, now),
  }));
}

/** Shortcuts to the things this person does most, limited to what they may do. */
function quickActions(user) {
  return [
    { label: 'Log a walk-in or call', href: '/portal/appointments/new', icon: 'calendar', permission: 'appointments.log' },
    { label: 'Add to the schedule', href: '/portal/schedule/new', icon: 'clock', permission: 'schedule.edit' },
    { label: 'Post an announcement', href: '/portal/announcements/new', icon: 'megaphone', permission: 'announcements.edit' },
    { label: 'Add a job', href: '/portal/jobs/new', icon: 'briefcase', permission: 'jobs.edit' },
    { label: 'Invite a staff member', href: '/portal/accounts/new', icon: 'users', permission: 'accounts.edit' },
    { label: 'Edit the website', href: '/portal/content', icon: 'pencil', permission: 'site_content.edit' },
  ].filter((a) => can(user, a.permission));
}

/**
 * Staff account housekeeping for people who manage accounts: who has not set
 * up two-step sign-in, who is locked out, and invitations not yet accepted.
 */
async function staffSecurity(user, now = new Date()) {
  if (!can(user, 'accounts.view')) return null;
  const twoStepOn = await require('./security').twoStepOn();
  const active = db('users as u').leftJoin('roles as r', 'r.key', 'u.role').where('u.status', 'active');

  const noTwoStep = await active.clone().where('u.mfa_enabled', false).where('u.must_change_password', false)
    .select('u.id', 'u.name', 'r.name as role_name', 'r.require_mfa').orderBy('r.require_mfa', 'desc').orderBy('u.name');
  const locked = await active.clone().where('u.locked_until', '>', now).select('u.id', 'u.name', 'u.locked_until').orderBy('u.locked_until');

  // Invited but not set up yet; the invite link may have run out.
  const lastInvite = db('password_tokens').where({ purpose: 'invite' }).groupBy('user_id').select('user_id').max({ expires_at: 'expires_at' }).as('t');
  const invited = await active.clone().where('u.must_change_password', true).leftJoin(lastInvite, 't.user_id', 'u.id')
    .select('u.id', 'u.name', 'u.created_at', 't.expires_at').orderBy('u.created_at', 'desc');

  return {
    twoStepOn,
    noTwoStep: noTwoStep.map((u) => ({ ...u, required: Boolean(u.require_mfa) && twoStepOn, href: `/portal/accounts/${u.id}` })),
    locked: locked.map((u) => ({ ...u, until: timeOf(u.locked_until), href: `/portal/accounts/${u.id}` })),
    invited: invited.map((u) => ({ ...u, expired: !u.expires_at || new Date(u.expires_at) <= now, href: `/portal/accounts/${u.id}` })),
  };
}

/** Panels data plus a short fingerprint, so the open dashboard knows when to refresh them. */
async function panels(user, now = new Date()) {
  const data = { attention: await attention(user, now), today: await today(user, now) };
  // Minute-level so "on now" and past appointments also update.
  const stamp = JSON.stringify({ ...data, minute: Math.floor(now.getTime() / 60000) });
  return { ...data, version: crypto.createHash('sha1').update(stamp).digest('hex').slice(0, 12) };
}

module.exports = { attention, today, quickActions, panels, staffSecurity, myShifts, recentActivity, businessDaysBefore, WAIT };
