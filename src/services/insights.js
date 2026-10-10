'use strict';

/**
 * Service-quality and planning charts for the dashboard:
 *  - response time: office hours from a referral or service request arriving
 *    to the team's first reply or status change
 *  - demand: which services people ask for, and from which counties
 *
 * Both read the intake inbox, limited to what the person may see.
 */

const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso } = require('../lib/hours');
const services = require('../content/services');

const COLORS = { green: '#12845a', blue: '#2a78d6', yellow: '#eda100', pink: '#e87ba4' };
const DEFAULT_SCHEDULE = { days: [1, 2, 3, 4, 5], open: 9, close: 17 };
const RESPONSE_KINDS = ['reply', 'status'];

/** Contact inbox scope for this user (the messages page rules), or null. */
const inboxScope = (user) => require('./messages').scopeFor(user, { alias: 'm' });

const hhmm = (h) => `${String(Math.floor(h)).padStart(2, '0')}:${String(Math.round((h % 1) * 60)).padStart(2, '0')}`;

/** Office hours (per the site's opening hours, Maryland time) between two instants. */
function officeHoursBetween(start, end, schedule = DEFAULT_SCHEDULE) {
  const from = new Date(start).getTime();
  const to = new Date(end).getTime();
  if (!(to > from)) return 0;
  let day = marylandParts(start).date;
  const last = marylandParts(end).date;
  let ms = 0;
  for (let guard = 0; guard < 800 && day <= last; guard++, day = addDaysIso(day, 1)) {
    const dow = new Date(`${day}T12:00:00Z`).getUTCDay();
    if (!schedule.days.includes(dow)) continue;
    const open = marylandDateTime(day, hhmm(schedule.open)).getTime();
    const close = marylandDateTime(day, hhmm(schedule.close)).getTime();
    ms += Math.max(0, Math.min(close, to) - Math.max(open, from));
  }
  return ms / 3600000;
}

function median(values) {
  if (!values.length) return null;
  const s = [...values].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

const round1 = (n) => (n === null ? null : Math.round(n * 10) / 10);

/** "3.5 office hours" or, past a working day, "1.4 office days". */
function describeHours(h, schedule = DEFAULT_SCHEDULE) {
  const day = schedule.close - schedule.open;
  if (h < day) return { value: `${round1(h)} h`, unit: 'office hours' };
  return { value: `${round1(h / day)} d`, unit: 'office days' };
}

function weeks(today, n) {
  const last = weekStartIso(today);
  return Array.from({ length: n }, (_, i) => addDaysIso(last, (i - n + 1) * 7));
}
const shortDate = (iso) => new Intl.DateTimeFormat('en-US', { month: 'short', day: 'numeric', timeZone: 'UTC' }).format(new Date(`${iso}T12:00:00Z`));

/** Weekly median time to first response for referrals and service requests. */
async function responseTime(user, today, schedule = DEFAULT_SCHEDULE) {
  const scope = inboxScope(user);
  if (!scope) return null;
  const starts = weeks(today, 12);
  const from = marylandDateTime(starts[0], '00:00');
  const firstResponse = db('contact_message_events').whereIn('kind', RESPONSE_KINDS).groupBy('message_id').select('message_id').min({ at: 'created_at' }).as('r');
  const rows = await scope(db('contact_messages as m'))
    .leftJoin(firstResponse, 'r.message_id', 'm.id')
    .whereIn('m.type', ['referral', 'request'])
    .where('m.created_at', '>=', from)
    .select('m.type', 'm.created_at', 'r.at as responded_at');

  const now = new Date();
  const index = (when) => starts.indexOf(weekStartIso(marylandParts(when).date));
  const series = [];
  for (const [key, name, color] of [['referral', 'Referrals', COLORS.blue], ['request', 'Service requests', COLORS.pink]]) {
    const buckets = starts.map(() => []);
    for (const r of rows) if (r.type === key && r.responded_at && index(r.created_at) >= 0) buckets[index(r.created_at)].push(officeHoursBetween(r.created_at, r.responded_at, schedule));
    series.push({ key, name, color, values: buckets.map((b) => round1(median(b))) });
  }

  const since90 = now.getTime() - 90 * 24 * 3600000;
  const recent = rows.filter((r) => new Date(r.created_at).getTime() >= since90);
  const answered = recent.filter((r) => r.responded_at).map((r) => officeHoursBetween(r.created_at, r.responded_at, schedule));
  const waiting = recent.filter((r) => !r.responded_at).length;
  const mid = median(answered);
  const shown = mid === null ? null : describeHours(mid, schedule);

  return {
    key: 'response',
    type: 'line',
    title: 'Response time',
    subtitle: 'Office hours to first reply or status change, weekly median',
    unit: 'office hours',
    valueSuffix: ' h',
    noTotals: true,
    categories: starts.map((d, i) => (i === starts.length - 1 ? 'This week' : shortDate(d))),
    categoryTitles: starts.map((d) => `Received week of ${shortDate(d)}`),
    series,
    figure: shown
      ? { value: shown.value, label: `median, last 90 days${waiting ? ` · ${waiting} not answered yet` : ''}` }
      : { value: '—', label: waiting ? `${waiting} waiting, none answered yet` : 'no referrals or requests yet' },
  };
}

/** What people ask for and where they are, from referrals and service requests (last 90 days). */
async function demand(user, today) {
  const scope = inboxScope(user);
  if (!scope) return [];
  const since = marylandDateTime(addDaysIso(today, -90), '00:00');
  const rows = await scope(db('contact_messages as m')).whereIn('m.type', ['referral', 'request']).where('m.created_at', '>=', since).select('m.details');

  const byService = new Map(services.map((s) => [s.slug, 0]));
  let notSure = 0;
  const byCounty = new Map();
  for (const r of rows) {
    let d = {};
    try {
      d = typeof r.details === 'string' ? JSON.parse(r.details) : r.details || {};
    } catch {
      d = {};
    }
    const chosen = Array.isArray(d.services) ? d.services.filter((s) => byService.has(s)) : [];
    if (chosen.length) chosen.forEach((s) => byService.set(s, byService.get(s) + 1));
    else notSure += 1;
    if (d.county) byCounty.set(d.county, (byCounty.get(d.county) || 0) + 1);
  }

  // Bar labels are short: "Community Development Services (CDS)" shows as "CDS".
  const serviceRows = services.map((s) => ({ label: (s.name.match(/\(([^)]+)\)/) || [])[1] || s.name, value: byService.get(s.slug) })).sort((a, b) => b.value - a.value);
  if (notSure) serviceRows.push({ label: 'Not sure yet', value: notSure });
  const asked = serviceRows.reduce((sum, r) => sum + r.value, 0);

  // Shorter labels, but Baltimore County keeps its name so it is not confused with Baltimore City.
  let countyRows = [...byCounty.entries()].map(([label, value]) => ({ label: label === 'Baltimore County' ? label : label.replace(/ County$/, ''), value })).sort((a, b) => b.value - a.value);
  if (countyRows.length > 8) {
    const other = countyRows.slice(7).reduce((sum, r) => sum + r.value, 0);
    countyRows = [...countyRows.slice(0, 7), { label: 'Other counties', value: other }];
  }
  const located = countyRows.reduce((sum, r) => sum + r.value, 0);

  const pct = (part, whole) => `${Math.round((part / whole) * 100)}%`;
  const charts = [
    {
      key: 'demand-services',
      type: 'bars',
      title: 'Services requested',
      subtitle: 'Referrals and service requests, last 90 days',
      unit: 'requests',
      categoryLabel: 'Service',
      categories: serviceRows.map((r) => r.label),
      series: [{ key: 'requests', name: 'Times requested', color: COLORS.blue, values: serviceRows.map((r) => r.value) }],
      figure: !rows.length
        ? { value: '0', label: 'requests yet' }
        : serviceRows[0].label === 'Not sure yet'
          ? { value: String(rows.length), label: 'requests, mostly not sure yet' }
          : { value: pct(serviceRows[0].value, asked), label: `of choices were ${serviceRows[0].label}` },
    },
  ];
  if (located || require('./messages').inboxesFor(user).includes('intake')) {
    charts.push({
      key: 'demand-counties',
      type: 'bars',
      title: 'Where requests come from',
      subtitle: 'By county, last 90 days',
      unit: 'requests',
      categoryLabel: 'County',
      categories: countyRows.length ? countyRows.map((r) => r.label) : ['No county given yet'],
      series: [{ key: 'requests', name: 'Requests', color: COLORS.green, values: countyRows.length ? countyRows.map((r) => r.value) : [0] }],
      figure: located ? { value: pct(countyRows[0].value, located), label: `from ${countyRows[0].label}` } : { value: '—', label: rows.length ? 'no county given yet' : 'no requests yet' },
    });
  }
  return charts;
}

module.exports = { responseTime, demand, officeHoursBetween, median, describeHours };
