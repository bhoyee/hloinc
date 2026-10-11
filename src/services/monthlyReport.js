'use strict';

/**
 * The monthly report: what came in and what happened in one calendar month
 * (Maryland time), compared with the month before. Counts only: no names or
 * contact details, so it can be shared with a board or funder.
 *
 * One structure feeds the page, the PDF (lib/reportPdf.js) and the CSV:
 *   { kpis: [...], sections: [{ title, intro, metrics: [...], breakdowns: [...] }], notes: [...] }
 */
const db = require('../db/knex');
const { marylandDateTime, marylandParts } = require('../lib/hours');
const { officeHoursBetween, median, describeHours } = require('./insights');
const { recipients } = require('../lib/site');
const services = require('../content/services');

const MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;
const ORIGIN_LABELS = { message: 'Contact form message', request: 'Service request', appointment: 'Appointment', referral: 'Referral', manual: 'Added by staff' };
const SOURCE_LABELS = { website: 'Website request', phone: 'Phone', walk_in: 'Walk-in' };

const monthLabel = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'long', year: 'numeric' });
const shortMonth = (m) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', month: 'short' });

function shiftMonth(m, by) {
  const [y, mo] = m.split('-').map(Number);
  const d = new Date(Date.UTC(y, mo - 1 + by, 1));
  return `${d.getUTCFullYear()}-${String(d.getUTCMonth() + 1).padStart(2, '0')}`;
}

const rangeOf = (m) => ({ from: marylandDateTime(`${m}-01`, '00:00'), to: marylandDateTime(`${shiftMonth(m, 1)}-01`, '00:00') });
const thisMonth = (now = new Date()) => marylandParts(now).date.slice(0, 7);

/** The months to choose from (newest first): this month back to the first with any data, at most 36. */
async function months(now = new Date()) {
  const current = thisMonth(now);
  const first = await db('contact_messages').min({ at: 'created_at' }).first();
  const firstMonth = first && first.at ? marylandParts(first.at).date.slice(0, 7) : current;
  const list = [];
  for (let m = current, i = 0; m >= firstMonth && i < 36; m = shiftMonth(m, -1), i++) list.push({ value: m, label: monthLabel(m) + (m === current ? ' (so far)' : '') });
  return list;
}

/** Last full month by default. */
const defaultMonth = (now = new Date()) => shiftMonth(thisMonth(now), -1);

const parse = (v) => {
  if (!v) return {};
  if (typeof v === 'object') return v;
  try {
    return JSON.parse(v);
  } catch {
    return {};
  }
};

const count = async (query) => Number((await query.count({ n: '*' }).first()).n);
const tally = (rows, key) => rows.reduce((map, r) => map.set(r[key], (map.get(r[key]) || 0) + 1), new Map());
const toRows = (map, labels = {}, limit = 8) => {
  let rows = [...map.entries()].filter(([, v]) => v > 0).map(([k, v]) => ({ label: labels[k] || k || 'Not given', value: v })).sort((a, b) => b.value - a.value);
  if (rows.length > limit) rows = [...rows.slice(0, limit - 1), { label: 'Other', value: rows.slice(limit - 1).reduce((s, r) => s + r.value, 0) }];
  return rows;
};

/** Everything counted for one month. */
async function gather(m) {
  const { from, to } = rangeOf(m);
  const inMonth = (q, col = 'created_at') => q.where(col, '>=', from).where(col, '<', to);

  // Intake: referrals and service requests
  const intake = await inMonth(db('contact_messages as m'), 'm.created_at').whereIn('m.type', ['referral', 'request'])
    .leftJoin(db('contact_message_events').whereIn('kind', ['reply', 'status']).groupBy('message_id').select('message_id').min({ at: 'created_at' }).as('r'), 'r.message_id', 'm.id')
    .select('m.type', 'm.details', 'm.created_at', 'r.at as responded_at');
  const byService = new Map();
  const byCounty = new Map();
  for (const r of intake) {
    const d = parse(r.details);
    const chosen = Array.isArray(d.services) ? d.services : [];
    if (chosen.length) for (const s of chosen) byService.set(s, (byService.get(s) || 0) + 1);
    else byService.set('not_sure', (byService.get('not_sure') || 0) + 1);
    if (d.county) byCounty.set(d.county, (byCounty.get(d.county) || 0) + 1);
  }
  const answered = intake.filter((r) => r.responded_at).map((r) => officeHoursBetween(r.created_at, r.responded_at));
  const responseMedian = median(answered);

  // Contact form
  const contact = await inMonth(db('contact_messages')).where({ type: 'message' }).select('recipient');

  // Appointments: requests received this month, and appointments that were due this month
  const websiteRequests = await count(inMonth(db('appointments')).where({ source: 'website' }));
  const due = await inMonth(db('appointments as a'), 'a.scheduled_at').leftJoin('appointment_types as t', 't.id', 'a.type_id').select('a.status', 'a.source', 't.name as type_name');
  const status = tally(due, 'status');
  const completed = status.get('completed') || 0;
  const noShow = status.get('no_show') || 0;
  const booked = due.filter((a) => a.status !== 'cancelled');

  // Leads
  const newLeads = await inMonth(db('leads')).select('origin');
  const stageMoves = await inMonth(db('lead_events')).where({ kind: 'stage' }).select('body');
  const becameClients = stageMoves.filter((e) => /to Became a client\.$/.test(e.body || '')).length;
  const closed = stageMoves.filter((e) => /to Not a fit \/ closed\.$/.test(e.body || '')).length;

  // Careers
  const applications = await inMonth(db('job_applications')).select('job_title');
  const hires = await inMonth(db('job_applications'), 'hired_at').select('job_title');
  const jobsPosted = await count(inMonth(db('jobs'), 'published_at'));

  return {
    referrals: intake.filter((r) => r.type === 'referral').length,
    requests: intake.filter((r) => r.type === 'request').length,
    responseMedian,
    unanswered: intake.length - answered.length,
    byService,
    byCounty,
    contact: contact.length,
    byInbox: tally(contact, 'recipient'),
    websiteRequests,
    completed,
    noShow,
    cancelled: status.get('cancelled') || 0,
    stillBooked: (status.get('confirmed') || 0) + (status.get('requested') || 0),
    attendance: completed + noShow ? Math.round((completed / (completed + noShow)) * 100) : null,
    bySource: tally(booked, 'source'),
    byType: tally(booked, 'type_name'),
    newLeads: newLeads.length,
    byOrigin: tally(newLeads, 'origin'),
    becameClients,
    closed,
    applications: applications.length,
    byJob: tally(applications, 'job_title'),
    hires: hires.length,
    hiresByJob: tally(hires, 'job_title'),
    jobsPosted,
  };
}

function change(value, prev) {
  if (typeof value !== 'number' || typeof prev !== 'number') return null;
  const diff = value - prev;
  if (!diff) return { diff: 0, text: 'Same as last month', tone: 'flat' };
  const pct = prev ? ` (${diff > 0 ? '+' : '-'}${Math.round((Math.abs(diff) / prev) * 100)}%)` : '';
  return { diff, text: `${diff > 0 ? '+' : '-'}${Math.abs(diff)}${pct} vs last month`, tone: diff > 0 ? 'up' : 'down' };
}

/** The report for month `m` ("2026-09"). */
async function build(m, { now = new Date(), user = null } = {}) {
  if (!MONTH.test(m)) throw Object.assign(new Error('Choose a month.'), { status: 400 });
  const prevM = shiftMonth(m, -1);
  const [c, p] = await Promise.all([gather(m), gather(prevM)]);
  const partial = m === thisMonth(now);
  const time = (h) => (h === null ? '—' : (({ value, unit }) => `${value.replace(' h', '').replace(' d', '')} ${unit}`)(describeHours(h)));
  const serviceLabels = Object.fromEntries([...services.map((s) => [s.slug, s.name]), ['not_sure', 'Not sure yet']]);
  const inboxLabels = Object.fromEntries(recipients.map((r) => [r.key, r.label]));
  const metric = (label, value, prev, extra = {}) => ({ label, value, prev, change: change(value, prev), ...extra });

  const kpis = [
    metric('Referrals', c.referrals, p.referrals),
    metric('Service requests', c.requests, p.requests),
    metric('Appointments held', c.completed, p.completed),
    metric('New clients', c.becameClients, p.becameClients),
    metric('Job applications', c.applications, p.applications),
    metric('Hires', c.hires, p.hires),
  ];

  const sections = [
    {
      key: 'intake',
      title: 'Referrals and service requests',
      intro: 'Sent through the website’s “Make a referral” and “Request services” forms.',
      metrics: [
        metric('Referrals received', c.referrals, p.referrals),
        metric('Service requests received', c.requests, p.requests),
        metric('Median time to first response', time(c.responseMedian), time(p.responseMedian), { note: 'Office hours from arrival to the team’s first reply or status change' }),
        metric('Not answered yet', c.unanswered, p.unanswered),
      ],
      breakdowns: [
        { title: 'Services asked for', rows: toRows(c.byService, serviceLabels) },
        { title: 'Counties', rows: toRows(c.byCounty) },
      ],
    },
    {
      key: 'appointments',
      title: 'Appointments',
      intro: 'Requests are counted in the month they arrived; appointments in the month they were due.',
      metrics: [
        metric('Requests from the website', c.websiteRequests, p.websiteRequests),
        metric('Appointments held', c.completed, p.completed),
        metric('No-shows', c.noShow, p.noShow),
        metric('Cancelled', c.cancelled, p.cancelled),
        ...(c.stillBooked || p.stillBooked ? [metric(partial ? 'Still to come or not yet marked' : 'Not yet marked held or no-show', c.stillBooked, p.stillBooked)] : []),
        metric('Attendance rate', c.attendance === null ? '—' : `${c.attendance}%`, p.attendance === null ? '—' : `${p.attendance}%`, { note: 'Held, out of held plus no-shows' }),
      ],
      breakdowns: [
        { title: 'How they were booked', rows: toRows(c.bySource, SOURCE_LABELS) },
        { title: 'Appointment types', rows: toRows(c.byType) },
      ],
    },
    {
      key: 'leads',
      title: 'People and families',
      intro: 'Everyone who reached out, followed from first contact to becoming a client.',
      metrics: [
        metric('New people who reached out', c.newLeads, p.newLeads),
        metric('Became clients', c.becameClients, p.becameClients),
        metric('Closed (not a fit)', c.closed, p.closed),
      ],
      breakdowns: [{ title: 'How they first reached out', rows: toRows(c.byOrigin, ORIGIN_LABELS) }],
    },
    {
      key: 'contact',
      title: 'Contact form messages',
      intro: 'Questions and messages from the Contact page, by who they were sent to.',
      metrics: [metric('Messages received', c.contact, p.contact)],
      breakdowns: [{ title: 'Sent to', rows: toRows(c.byInbox, inboxLabels) }],
    },
    {
      key: 'careers',
      title: 'Careers',
      intro: 'Applications sent through the careers page, and people marked as hired.',
      metrics: [
        metric('Jobs posted', c.jobsPosted, p.jobsPosted),
        metric('Applications received', c.applications, p.applications),
        metric('Hires', c.hires, p.hires),
      ],
      breakdowns: [
        { title: 'Applications by job', rows: toRows(c.byJob) },
        ...(c.hires ? [{ title: 'Hires by job', rows: toRows(c.hiresByJob) }] : []),
      ],
    },
  ];

  for (const s of sections) for (const b of s.breakdowns) b.max = Math.max(1, ...b.rows.map((r) => r.value));

  return {
    month: m,
    label: monthLabel(m),
    prevLabel: monthLabel(prevM),
    prevShort: shortMonth(prevM),
    partial,
    generatedAt: now,
    generatedBy: user ? user.name : null,
    kpis,
    sections,
    notes: [
      'All counts use Maryland time. Each item is counted in the month it arrived, except appointments (the month they were due) and hires (the month they were marked hired).',
      'New clients and closed counts come from the stage changes staff make on Leads.',
      'This report contains counts only: no names or contact details.',
    ],
  };
}

/** CSV (opens in Excel): one row per measure and per breakdown line. */
function toCsv(report) {
  const cell = (v) => {
    const s = v === null || v === undefined ? '' : String(v);
    return /[",\n\r]/.test(s) || /^[=+\-@]/.test(s) ? `"${(/^[=+\-@]/.test(s) ? `'${s}` : s).replace(/"/g, '""')}"` : s;
  };
  const lines = [
    ['Healthy Living Option Inc. monthly report', report.label + (report.partial ? ' (so far)' : '')],
    [],
    ['Section', 'Measure', report.label, report.prevLabel],
  ];
  lines.push(...report.kpis.map((k) => ['Highlights', k.label, k.value, k.prev]));
  for (const s of report.sections) {
    lines.push(...s.metrics.map((mtr) => [s.title, mtr.label, mtr.value, mtr.prev]));
    for (const b of s.breakdowns) lines.push(...b.rows.map((r) => [s.title, `${b.title}: ${r.label}`, r.value, '']));
  }
  lines.push([], ...report.notes.map((n) => ['Note', n]));
  return `﻿${lines.map((l) => l.map(cell).join(',')).join('\r\n')}\r\n`;
}

module.exports = { build, months, defaultMonth, toCsv, shiftMonth, MONTH };
