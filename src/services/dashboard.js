'use strict';

/**
 * Everything the dashboard shows that changes during the day: the headline
 * tiles and the analytics charts. The page renders it once and the browser
 * then asks /portal/dashboard/data for a fresh copy every 30 seconds.
 *
 * Each tile and chart is included only if the user's role can already see
 * that area, so the dashboard never reveals more than the rest of the portal.
 */
const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { officeStatus, marylandDateTime, marylandParts, addDaysIso, weekStartIso } = require('../lib/hours');
const { SOURCE_LABELS } = require('./appointments');
const insights = require('./insights');

const count = (query) => query.count({ n: '*' }).first().then((r) => Number(r.n));

/*
 * Chart colors, in fixed order (checked for color-blind safety on white with
 * the palette validator). Each series keeps its color wherever it appears.
 */
const COLORS = { green: '#12845a', blue: '#2a78d6', yellow: '#eda100', pink: '#e87ba4' };

/** Contact inbox scope for this user: everything, intake only, or nothing. */
function inboxScope(user) {
  if (can(user, 'messages.view')) return (q) => q;
  if (can(user, 'messages.view_intake')) return (q) => q.where({ recipient: 'intake' });
  return null;
}

const shortDate = (iso) =>
  new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** Maryland calendar date (YYYY-MM-DD) of a stored timestamp. */
const dayOf = (when) => marylandParts(new Date(when)).date;

/** `n` Monday-start weeks ending `ahead` weeks after this one. */
function weeks(today, n, ahead = 0) {
  const last = addDaysIso(weekStartIso(today), ahead * 7);
  return Array.from({ length: n }, (_, i) => addDaysIso(last, (i - n + 1) * 7));
}

async function tiles(user, today) {
  const list = [];
  const scope = inboxScope(user);
  if (scope) {
    list.push({
      key: 'messages',
      label: 'New messages',
      icon: 'inbox',
      value: await count(scope(db('contact_messages').where({ status: 'new', type: 'message' }).whereNull('archived_at'))),
      note: 'From the website contact form',
      href: '/portal/messages?tab=new&type=message',
    });
    list.push({
      key: 'referrals',
      label: 'New referrals',
      icon: 'document',
      value: await count(scope(db('contact_messages').where({ status: 'new', type: 'referral' }).whereNull('archived_at'))),
      note: 'Waiting for the intake team',
      href: '/portal/messages?tab=new&type=referral',
    });
    list.push({
      key: 'service_requests',
      label: 'New service requests',
      icon: 'heart',
      value: await count(scope(db('contact_messages').where({ status: 'new', type: 'request' }).whereNull('archived_at'))),
      note: 'From individuals and families',
      href: '/portal/messages?tab=new&type=request',
    });
  }
  if (can(user, 'appointments.view')) {
    // One card with two parts, so the dashboard stays at six cards or fewer.
    list.push({
      key: 'appointments',
      label: 'Appointments',
      icon: 'calendar',
      parts: [
        {
          key: 'requests',
          label: 'Requests',
          value: await count(db('appointments').where({ status: 'requested' })),
          note: 'To confirm',
          href: '/portal/appointments?tab=requests',
        },
        {
          key: 'today',
          label: 'Today',
          value: await count(
            db('appointments')
              .where({ status: 'confirmed' })
              .where('scheduled_at', '>=', marylandDateTime(today, '00:00'))
              .where('scheduled_at', '<', marylandDateTime(addDaysIso(today, 1), '00:00'))
          ),
          note: 'Confirmed',
          href: `/portal/appointments/calendar?date=${today}`,
        },
      ],
    });
  }
  if (can(user, 'jobs.view')) {
    list.push({ key: 'jobs', label: 'Open jobs', icon: 'briefcase', value: await count(db('jobs').where({ status: 'published' })), note: 'Live on the careers page', href: '/portal/jobs' });
  }
  if (can(user, 'accounts.view')) {
    list.push({
      key: 'staff',
      label: 'Active staff accounts',
      icon: 'users',
      value: await count(db('users').where({ status: 'active' })),
      note: 'People who can sign in',
      href: '/portal/accounts',
    });
  }
  return list;
}

/** Appointments per week (5 past, this week, 2 ahead), split by outcome. */
async function appointmentsByWeek(today) {
  const starts = weeks(today, 8, 2);
  const from = marylandDateTime(starts[0], '00:00');
  const to = marylandDateTime(addDaysIso(starts[starts.length - 1], 7), '00:00');
  const rows = await db('appointments')
    .whereIn('status', ['completed', 'confirmed', 'no_show', 'cancelled'])
    .whereRaw('COALESCE(scheduled_at, created_at) >= ? AND COALESCE(scheduled_at, created_at) < ?', [from, to])
    .select('status', 'scheduled_at', 'created_at');

  const series = [
    { key: 'completed', name: 'Completed', color: COLORS.green },
    { key: 'confirmed', name: 'Confirmed', color: COLORS.blue },
    { key: 'no_show', name: 'No-show', color: COLORS.yellow },
    { key: 'cancelled', name: 'Cancelled', color: COLORS.pink },
  ].map((s) => ({ ...s, values: starts.map(() => 0) }));
  const byKey = Object.fromEntries(series.map((s) => [s.key, s]));
  for (const r of rows) {
    const i = starts.indexOf(weekStartIso(dayOf(r.scheduled_at || r.created_at)));
    if (i >= 0) byKey[r.status].values[i] += 1;
  }

  // Attendance over the last 90 days: of the appointments that were due, how many happened.
  const since = marylandDateTime(addDaysIso(today, -90), '00:00');
  const outcome = await db('appointments')
    .whereIn('status', ['completed', 'no_show'])
    .where('scheduled_at', '>=', since)
    .select('status')
    .count({ n: '*' })
    .groupBy('status');
  const done = Number((outcome.find((o) => o.status === 'completed') || {}).n || 0);
  const missed = Number((outcome.find((o) => o.status === 'no_show') || {}).n || 0);

  const current = starts.indexOf(weekStartIso(today));
  return {
    key: 'appointments',
    type: 'columns',
    title: 'Appointments by week',
    subtitle: 'Past five weeks, this week and the next two',
    unit: 'appointments',
    categories: starts.map((d, i) => (i === current ? 'This week' : shortDate(d))),
    categoryTitles: starts.map((d) => `Week of ${shortDate(d)}`),
    highlight: current,
    series,
    figure: done + missed ? { value: `${Math.round((done / (done + missed)) * 100)}%`, label: 'attended in the last 90 days' } : { value: '—', label: 'no attendance recorded yet' },
  };
}

/** Website enquiries per week over the last 12 weeks. */
async function enquiriesByWeek(user, today) {
  const starts = weeks(today, 12);
  const from = marylandDateTime(starts[0], '00:00');
  const index = (when) => starts.indexOf(weekStartIso(dayOf(when)));
  const series = [];

  const scope = inboxScope(user);
  if (scope) {
    const rows = await scope(db('contact_messages').where('created_at', '>=', from)).select('type', 'created_at');
    for (const [key, name, color] of [['message', 'Contact messages', COLORS.green], ['referral', 'Referrals', COLORS.blue], ['request', 'Service requests', COLORS.pink]]) {
      const values = starts.map(() => 0);
      for (const r of rows) if (r.type === key && index(r.created_at) >= 0) values[index(r.created_at)] += 1;
      series.push({ key, name, color, values });
    }
  }
  if (can(user, 'appointments.view')) {
    const rows = await db('appointments').where({ source: 'website' }).where('created_at', '>=', from).select('created_at');
    const values = starts.map(() => 0);
    for (const r of rows) if (index(r.created_at) >= 0) values[index(r.created_at)] += 1;
    series.push({ key: 'appointment', name: 'Appointment requests', color: COLORS.yellow, values });
  }
  if (!series.length) return null;

  const total = series.reduce((sum, s) => sum + s.values.reduce((a, b) => a + b, 0), 0);
  return {
    key: 'enquiries',
    type: 'line',
    title: 'Website enquiries',
    subtitle: 'Per week, last 12 weeks',
    unit: 'enquiries',
    categories: starts.map((d, i) => (i === starts.length - 1 ? 'This week' : shortDate(d))),
    categoryTitles: starts.map((d) => `Week of ${shortDate(d)}`),
    series,
    figure: { value: total.toLocaleString('en-US'), label: 'in the last 12 weeks' },
  };
}

/** How appointments arrived over the last 90 days. */
async function bookingSources(today) {
  const since = marylandDateTime(addDaysIso(today, -90), '00:00');
  const rows = await db('appointments').where('created_at', '>=', since).select('source').count({ n: '*' }).groupBy('source');
  const keys = Object.keys(SOURCE_LABELS);
  const values = keys.map((k) => Number((rows.find((r) => r.source === k) || {}).n || 0));
  const total = values.reduce((a, b) => a + b, 0);
  const top = total ? keys[values.indexOf(Math.max(...values))] : null;
  return {
    key: 'sources',
    type: 'bars',
    title: 'How people book',
    subtitle: 'Appointments by source, last 90 days',
    unit: 'appointments',
    categories: keys.map((k) => SOURCE_LABELS[k]),
    series: [{ key: 'appointments', name: 'Appointments', color: COLORS.green, values }],
    figure: top ? { value: `${Math.round((Math.max(...values) / total) * 100)}%`, label: `came by ${SOURCE_LABELS[top].toLowerCase()}` } : { value: '0', label: 'appointments yet' },
  };
}

/** Staff sign-ins per day over the last 14 days. */
async function signIns(today) {
  const days = Array.from({ length: 14 }, (_, i) => addDaysIso(today, i - 13));
  const rows = await db('audit_log')
    .where({ action: 'auth.login' })
    .where('created_at', '>=', marylandDateTime(days[0], '00:00'))
    .select('user_id', 'created_at');
  const values = days.map(() => 0);
  const people = new Set();
  for (const r of rows) {
    const i = days.indexOf(dayOf(r.created_at));
    if (i >= 0) values[i] += 1;
    if (r.user_id) people.add(r.user_id);
  }
  const weekday = (iso) => new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));
  return {
    key: 'signins',
    type: 'columns',
    title: 'Staff sign-ins',
    subtitle: 'Per day, last 14 days',
    unit: 'sign-ins',
    categories: days.map((d, i) => (i === days.length - 1 ? 'Today' : shortDate(d))),
    categoryTitles: days.map((d) => `${weekday(d)} ${shortDate(d)}`),
    highlight: days.length - 1,
    series: [{ key: 'signins', name: 'Sign-ins', color: COLORS.green, values }],
    figure: { value: String(people.size), label: people.size === 1 ? 'person signed in' : 'people signed in' },
  };
}

async function charts(user, today, schedule) {
  if (!can(user, 'reports.view')) return [];
  const list = [];
  if (can(user, 'appointments.view')) list.push(await appointmentsByWeek(today));
  list.push(await enquiriesByWeek(user, today));
  // Service quality and planning (intake inbox).
  list.push(await insights.responseTime(user, today, schedule || undefined));
  list.push(...(await insights.demand(user, today)));
  if (can(user, 'appointments.view')) list.push(await bookingSources(today));
  if (can(user, 'audit.view')) list.push(await signIns(today));
  // Per-category totals, for tooltips and the table view (empty weeks count as 0).
  return list.filter(Boolean).map((c) => ({ ...c, totals: c.categories.map((_, i) => c.series.reduce((sum, s) => sum + (s.values[i] || 0), 0)) }));
}

/** "Office open · until 5 PM" / "Office closed · opens tomorrow at 9 AM". */
function officeLine(schedule, now) {
  const status = officeStatus(schedule, now);
  return { open: status.open, label: `Office ${status.label.replace(/^Open now/, 'open').replace(/^Closed/, 'closed')}` };
}

/** The live part of the dashboard for this user. */
async function snapshot(user, schedule) {
  const now = new Date();
  const today = marylandParts(now).date;
  return {
    updatedAt: now.toISOString(),
    office: schedule ? officeLine(schedule, now) : null,
    tiles: await tiles(user, today),
    charts: await charts(user, today, schedule),
  };
}

module.exports = { snapshot, COLORS };
