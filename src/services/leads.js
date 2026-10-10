'use strict';

/**
 * Leads: everyone who has reached out, one record per person, with their
 * stage in intake, an owner, notes, and a timeline of everything they sent.
 *
 * New submissions are attached automatically (see attach*): families,
 * enquiries and appointments are matched by email (or phone if there is no
 * email); each referral is its own lead for the person referred.
 */

const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { normalizeSearch } = require('../lib/reference');
const services = require('../content/services');

const STAGES = {
  new: { label: 'New', tone: 'red' },
  contacted: { label: 'Contacted', tone: 'amber' },
  intake: { label: 'Intake in progress', tone: 'blue' },
  client: { label: 'Became a client', tone: 'green' },
  not_fit: { label: 'Not a fit / closed', tone: 'grey' },
};
const OPEN_STAGES = ['new', 'contacted', 'intake'];
const ORIGIN_LABELS = { message: 'Website message', request: 'Service request', appointment: 'Appointment', referral: 'Referral', manual: 'Added by staff' };
// Contact form messages that are about starting services.
const LEAD_RECIPIENTS = ['intake', 'general'];

const TABS = {
  open: { label: 'Open', where: (q) => q.whereIn('l.stage', OPEN_STAGES) },
  new: { label: 'New', where: (q) => q.where('l.stage', 'new') },
  contacted: { label: 'Contacted', where: (q) => q.where('l.stage', 'contacted') },
  intake: { label: 'Intake', where: (q) => q.where('l.stage', 'intake') },
  client: { label: 'Clients', where: (q) => q.where('l.stage', 'client') },
  not_fit: { label: 'Closed', where: (q) => q.where('l.stage', 'not_fit') },
  all: { label: 'All', where: (q) => q },
};

const PER_PAGE = 25;

function digitsOf(phone) {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
}

const serviceName = (slug) => (services.find((s) => s.slug === slug) || {}).name;
const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Merge newly chosen services into what the lead already has. */
function mergeServices(current, extra) {
  const list = Array.isArray(current) ? current : current ? JSON.parse(current) : [];
  const merged = [...new Set([...list, ...(extra || [])])];
  return merged.length ? JSON.stringify(merged) : null;
}

/**
 * Find the lead for this person (by email, else phone) or start a new one.
 * `started` moves a New lead to Contacted (e.g. staff logged a call).
 */
async function findOrCreate(trx, { origin, name, email, phone, county, services: chosen }) {
  const lower = email ? String(email).toLowerCase() : null;
  const digits = digitsOf(phone);
  let lead = null;
  if (lower) lead = await trx('leads').whereNot({ origin: 'referral' }).where({ email: lower }).orderBy('id').first();
  if (!lead && !lower && digits) lead = await trx('leads').whereNot({ origin: 'referral' }).where({ phone_digits: digits }).orderBy('id').first();

  if (lead) {
    await trx('leads').where({ id: lead.id }).update({
      last_activity_at: trx.fn.now(),
      phone: lead.phone || phone || null,
      phone_digits: lead.phone_digits || digits,
      county: lead.county || county || null,
      services: mergeServices(lead.services, chosen),
      // Someone coming back after being closed is worth another look.
      stage: lead.stage === 'not_fit' ? 'new' : lead.stage,
    });
    return lead.id;
  }
  const [id] = await trx('leads').insert({
    origin, name, email: lower, phone: phone || null, phone_digits: digits, county: county || null,
    services: chosen && chosen.length ? JSON.stringify(chosen) : null,
  });
  return id;
}

/** A website message: only enquiries to intake or general become leads. */
async function attachMessage(messageId, data) {
  if (!LEAD_RECIPIENTS.includes(data.recipient)) return null;
  const leadId = await findOrCreate(db, { origin: 'message', name: data.name, email: data.email, phone: data.phone });
  await db('contact_messages').where({ id: messageId }).update({ lead_id: leadId });
  return leadId;
}

/** A "Request services" form. */
async function attachRequest(messageId, data) {
  const leadId = await findOrCreate(db, {
    origin: 'request', name: `${data.first_name} ${data.last_name}`, email: data.email, phone: data.phone, county: data.county, services: data.services,
  });
  await db('contact_messages').where({ id: messageId }).update({ lead_id: leadId });
  return leadId;
}

/** A referral: always a new lead for the person referred. */
async function attachReferral(messageId, data) {
  const [leadId] = await db('leads').insert({
    origin: 'referral',
    name: data.person_name,
    email: data.referrer_email ? String(data.referrer_email).toLowerCase() : null,
    phone: data.referrer_phone || null,
    phone_digits: digitsOf(data.referrer_phone),
    referred_by: [data.referrer_name, data.organization].filter(Boolean).join(', '),
    county: data.county || null,
    services: data.services && data.services.length ? JSON.stringify(data.services) : null,
  });
  await db('contact_messages').where({ id: messageId }).update({ lead_id: leadId });
  return leadId;
}

/** An appointment (website request, or a walk-in / call logged by staff). */
async function attachAppointment(appointmentId, data, { byStaff = false } = {}) {
  const leadId = await findOrCreate(db, { origin: 'appointment', name: data.name, email: data.email, phone: data.phone });
  await db('appointments').where({ id: appointmentId }).update({ lead_id: leadId });
  if (byStaff) await db('leads').where({ id: leadId, stage: 'new' }).update({ stage: 'contacted' });
  return leadId;
}

/** Staff replied, changed a status or confirmed an appointment: a New lead is now Contacted. */
async function markContacted(leadId, user) {
  if (!leadId) return;
  const moved = await db('leads').where({ id: leadId, stage: 'new' }).update({ stage: 'contacted', last_activity_at: db.fn.now() });
  if (moved) await event(leadId, user, 'stage', 'Moved to Contacted automatically after the first response.');
}

function event(leadId, user, kind, body) {
  return db('lead_events').insert({ lead_id: leadId, user_id: user ? user.id : null, user_name: user ? user.name : null, kind, body });
}

function base() {
  return db('leads as l').leftJoin('users as o', 'o.id', 'l.owner_id');
}

function applyFilters(query, user, { tab = 'open', q = '', origin = '', owner = '' } = {}) {
  (TABS[tab] || TABS.open).where(query);
  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = likeOf(keyword);
    const digits = keyword.replace(/\D/g, '');
    const code = normalizeSearch(keyword);
    query.where((w) => {
      w.where('l.name', 'like', like).orWhere('l.email', 'like', like).orWhere('l.referred_by', 'like', like).orWhere('l.county', 'like', like);
      if (digits.length >= 4) w.orWhere('l.phone_digits', 'like', `%${digits}%`);
      // A reference number finds the lead it belongs to.
      if (code) {
        w.orWhereIn('l.id', db('contact_messages').whereNotNull('lead_id').where('reference', 'like', `%-${code}`).select('lead_id'))
          .orWhereIn('l.id', db('appointments').whereNotNull('lead_id').where('reference', 'like', `%-${code}`).select('lead_id'));
      }
    });
  }
  if (ORIGIN_LABELS[origin]) {
    query.where((w) => {
      w.where('l.origin', origin);
      if (origin === 'appointment') w.orWhereIn('l.id', db('appointments').whereNotNull('lead_id').select('lead_id'));
      else if (origin !== 'manual') w.orWhereIn('l.id', db('contact_messages').whereNotNull('lead_id').where('type', origin).select('lead_id'));
    });
  }
  if (owner === 'me') query.where('l.owner_id', user.id);
  else if (owner === 'none') query.whereNull('l.owner_id');
  return query;
}

/** How each lead came in: counts per kind of submission. */
async function touchpoints(ids) {
  const out = new Map(ids.map((id) => [id, { message: 0, request: 0, referral: 0, appointment: 0 }]));
  if (!ids.length) return out;
  for (const r of await db('contact_messages').whereIn('lead_id', ids).select('lead_id', 'type').count({ n: '*' }).groupBy('lead_id', 'type')) out.get(r.lead_id)[r.type] = Number(r.n);
  for (const r of await db('appointments').whereIn('lead_id', ids).select('lead_id').count({ n: '*' }).groupBy('lead_id')) out.get(r.lead_id).appointment = Number(r.n);
  return out;
}

async function list(user, filters = {}) {
  const perPage = filters.perPage || PER_PAGE;
  const query = applyFilters(base(), user, filters);
  const total = Number((await query.clone().count({ n: '*' }).first()).n);
  const page = Math.min(Math.max(1, Number(filters.page) || 1), Math.max(1, Math.ceil(total / perPage)));
  const rows = await query
    .select('l.*', 'o.name as owner_name')
    .orderBy('l.last_activity_at', 'desc')
    .limit(perPage)
    .offset((page - 1) * perPage);
  const touches = await touchpoints(rows.map((r) => r.id));
  const counts = Object.fromEntries(
    (await db('leads').select('stage').count({ n: '*' }).groupBy('stage')).map((r) => [r.stage, Number(r.n)])
  );
  return {
    items: rows.map((r) => ({ ...r, touches: touches.get(r.id) })),
    total,
    page,
    pages: Math.max(1, Math.ceil(total / perPage)),
    stageCounts: { ...counts, open: OPEN_STAGES.reduce((n, k) => n + (counts[k] || 0), 0) },
  };
}

/** The most recently active leads, for the dashboard. */
async function recent(limit = 6) {
  const rows = await base().select('l.*', 'o.name as owner_name').orderBy('l.last_activity_at', 'desc').limit(limit);
  const touches = await touchpoints(rows.map((r) => r.id));
  const openCount = Number((await db('leads').whereIn('stage', OPEN_STAGES).count({ n: '*' }).first()).n);
  return { items: rows.map((r) => ({ ...r, touches: touches.get(r.id) })), openCount };
}

const get = (id) => base().select('l.*', 'o.name as owner_name').where('l.id', id).first();

/** Everything linked to a lead, newest first. Message details respect the viewer's inbox access. */
async function timeline(lead, user) {
  const items = [];
  const scope = require('./messages').scopeFor(user, { alias: '' });
  const msgs = await db('contact_messages').where({ lead_id: lead.id }).select('id', 'reference', 'type', 'recipient', 'status', 'message', 'created_at');
  const visibleIds = new Set(scope ? await scope(db('contact_messages').where({ lead_id: lead.id })).pluck('id') : []);
  for (const m of msgs) {
    const visible = visibleIds.has(m.id);
    items.push({
      at: m.created_at,
      kind: m.type,
      title: { message: 'Website message', request: 'Service request', referral: 'Referral' }[m.type],
      reference: m.reference,
      status: m.status,
      text: visible ? m.message : null,
      href: visible ? `/portal/messages/${m.id}` : null,
    });
  }
  if (can(user, 'appointments.view')) {
    const appts = await db('appointments as a').leftJoin('appointment_types as t', 't.id', 'a.type_id').where('a.lead_id', lead.id)
      .select('a.id', 'a.reference', 'a.status', 'a.source', 'a.scheduled_at', 'a.created_at', 't.name as type_name');
    for (const a of appts) items.push({ at: a.created_at, kind: 'appointment', title: `Appointment: ${a.type_name}`, reference: a.reference, status: a.status, scheduledAt: a.scheduled_at, source: a.source, href: `/portal/appointments/${a.id}` });
  }
  for (const e of await db('lead_events').where({ lead_id: lead.id }).orderBy('id')) {
    items.push({ at: e.created_at, kind: `event-${e.kind}`, title: e.user_name || 'System', text: e.body });
  }
  return items.sort((a, b) => new Date(b.at) - new Date(a.at));
}

async function setStage(lead, stage, user) {
  if (!STAGES[stage] || stage === lead.stage) return false;
  await db('leads').where({ id: lead.id }).update({ stage, last_activity_at: db.fn.now() });
  await event(lead.id, user, 'stage', `Stage changed from ${STAGES[lead.stage].label} to ${STAGES[stage].label}.`);
  return true;
}

async function setOwner(lead, owner, user) {
  const ownerId = owner ? owner.id : null;
  if ((lead.owner_id || null) === ownerId) return false;
  await db('leads').where({ id: lead.id }).update({ owner_id: ownerId });
  await event(lead.id, user, 'owner', owner ? `Assigned to ${owner.name}.` : 'Owner removed.');
  return true;
}

async function updateDetails(lead, data, user) {
  const changes = {
    name: data.name,
    email: data.email ? data.email.toLowerCase() : null,
    phone: data.phone || null,
    phone_digits: digitsOf(data.phone),
    county: data.county || null,
  };
  const changed = Object.keys(changes).filter((k) => k !== 'phone_digits' && (lead[k] || null) !== (changes[k] || null));
  if (!changed.length) return false;
  await db('leads').where({ id: lead.id }).update(changes);
  await event(lead.id, user, 'details', `Updated ${changed.map((k) => ({ name: 'name', email: 'email', phone: 'phone', county: 'county' })[k]).join(', ')}.`);
  return true;
}

async function addNote(lead, note, user) {
  await event(lead.id, user, 'note', note);
  await db('leads').where({ id: lead.id }).update({ last_activity_at: db.fn.now() });
}

const remove = (id) => db('leads').where({ id }).del();

/** Rows for the CSV export (same filters as the list, no paging). */
async function exportRows(user, filters) {
  const rows = await applyFilters(base(), user, filters).select('l.*', 'o.name as owner_name').orderBy('l.last_activity_at', 'desc').limit(5000);
  const touches = await touchpoints(rows.map((r) => r.id));
  return rows.map((r) => {
    const t = touches.get(r.id);
    const chosen = r.services ? (typeof r.services === 'string' ? JSON.parse(r.services) : r.services) : [];
    return {
      Name: r.name,
      Stage: STAGES[r.stage].label,
      Owner: r.owner_name || '',
      Email: r.email || '',
      Phone: r.phone || '',
      County: r.county || '',
      'Referred by': r.referred_by || '',
      'First came in as': ORIGIN_LABELS[r.origin],
      'Service requests': t.request,
      Referrals: t.referral,
      'Website messages': t.message,
      Appointments: t.appointment,
      'Services of interest': chosen.map(serviceName).filter(Boolean).join('; '),
      'First contact': new Date(r.created_at).toISOString().slice(0, 10),
      'Last activity': new Date(r.last_activity_at).toISOString().slice(0, 10),
    };
  });
}

/** Spreadsheet-safe CSV (cells starting with = + - @ are prefixed so they are not run as formulas). */
function toCsv(rows) {
  if (!rows.length) return 'No leads match these filters\r\n';
  const cell = (v) => {
    let s = String(v ?? '');
    if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`;
    return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const headers = Object.keys(rows[0]);
  return [headers.map(cell).join(','), ...rows.map((r) => headers.map((h) => cell(r[h])).join(','))].join('\r\n') + '\r\n';
}

module.exports = {
  STAGES, OPEN_STAGES, ORIGIN_LABELS, TABS, LEAD_RECIPIENTS,
  attachMessage, attachRequest, attachReferral, attachAppointment, markContacted,
  list, recent, get, timeline, setStage, setOwner, updateDetails, addNote, remove, exportRows, toCsv, serviceName, digitsOf,
};
