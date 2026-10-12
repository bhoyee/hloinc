'use strict';

const db = require('../db/knex');
const { can, inboxPermission } = require('../auth/permissions');
const { recipients } = require('../lib/site');
const { orWherePhone } = require('../validation/phone');
const { notify } = require('./notify');
const content = require('./content');

/*
 * The contacts inbox (requirements §5.5): website messages and referrals,
 * routed by the recipient the sender chose. Statuses New → In progress →
 * Resolved, internal notes, email replies, and a history of every change.
 */

const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const TYPE_LABELS = { message: 'Message', referral: 'Referral', request: 'Service request' };
const RECIPIENT_LABELS = Object.fromEntries(recipients.map((r) => [r.key, r.label]));
const KIND = { message: 'message', referral: 'referral', request: 'request for services' };

/**
 * The extra answers from the referral and request-services forms, as labelled
 * rows for the inbox. Older referrals (before HLO's October 2026 form) keep
 * their original fields.
 */
function detailRows(m) {
  const { OPTIONS, REFERRER_ROLES } = require('../validation/public');
  const services = require('../content/services');
  const d = m.details || {};
  const pick = (list, key) => (key ? list[key] || key : null);
  const svc = (slugs) => (slugs && slugs.length ? slugs.map((s) => (services.find((x) => x.slug === s) || { name: s }).name) : null);
  const rows =
    m.type === 'referral'
      ? [
          ['Role', pick(REFERRER_ROLES, d.referrer_role)],
          ['Agency or organization', d.organization],
          ['Person (first name or initials)', d.person_name],
          ['County', d.county],
          ['Current living situation', pick(OPTIONS.livingSituation, d.living_situation)],
          ['DDA eligibility', pick(OPTIONS.ddaEligibility, d.dda_eligibility)],
          ['DDA funding priority', pick(OPTIONS.priority, d.priority_category)],
          ['Person-Centered Plan', pick(OPTIONS.pcp, d.pcp)],
          ['How soon', pick(OPTIONS.timeline, d.timeline)],
          ['Their phone', d.person_phone],
          ['Their email', d.person_email],
        ]
      : m.type === 'request'
        ? [
            ['Prefers', d.preferred_contact === 'email' ? 'Email' : 'Phone'],
            ['Best time to call', pick(OPTIONS.bestTime, d.best_time)],
            ['Relationship to the person', pick(OPTIONS.relationship, d.relationship)],
            ['Their first name', d.individual_first_name],
            ['County', d.county],
            ['DDA eligibility', pick(OPTIONS.ddaEligibility, d.dda_eligibility)],
            ['Person-Centered Plan', pick(OPTIONS.pcp, d.pcp)],
            ['DDA funding priority', pick(OPTIONS.priority, d.priority_category)],
          ]
        : [];
  return {
    rows: rows.filter(([, v]) => v).map(([label, value]) => ({ label, value })),
    services: m.type === 'message' ? null : svc(d.services) || ['Not sure yet'],
  };
}

const TABS = {
  new: { label: 'New', where: (q) => q.whereNull('m.archived_at').where('m.status', 'new') },
  in_progress: { label: 'In progress', where: (q) => q.whereNull('m.archived_at').where('m.status', 'in_progress') },
  resolved: { label: 'Resolved', where: (q) => q.whereNull('m.archived_at').where('m.status', 'resolved') },
  archived: { label: 'Archived', where: (q) => q.whereNotNull('m.archived_at') },
  all: { label: 'All', where: (q) => q },
};

/**
 * Quick views over the inbox (with the status tabs): contact page messages,
 * intake (referrals and service requests), and the ones assigned to you.
 */
const VIEWS = {
  all: { label: 'All' },
  contact: { label: 'Contact messages', where: (q) => q.where('m.type', 'message') },
  intake: { label: 'Intake', where: (q) => q.whereIn('m.type', ['referral', 'request']) },
  mine: { label: 'Assigned to me' },
};

/** The contact form inboxes this person can open (all of them with "View all"). Intake includes referrals and service requests. */
function inboxesFor(user) {
  if (can(user, 'messages.view')) return recipients.map((r) => r.key);
  return recipients.filter((r) => can(user, inboxPermission(r.key))).map((r) => r.key);
}

/**
 * Which messages this person may see. "View all" (Admin by default): every
 * message. Otherwise the inboxes ticked for their role, plus anything assigned
 * to them. No inbox at all: nothing. Returns a query modifier or null. `alias`
 * is the table alias the query uses for contact_messages ('' for none).
 */
function scopeFor(user, { alias = 'm' } = {}) {
  const col = (c) => (alias ? `${alias}.${c}` : c);
  if (can(user, 'messages.view')) return (q) => q;
  const mine = inboxesFor(user);
  if (!mine.length) return null;
  return (q) => q.where((w) => w.whereIn(col('recipient'), mine).orWhere(col('assigned_to'), user.id));
}

const { of: ref, normalizeSearch } = require('../lib/reference');

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

function base(user) {
  const scope = scopeFor(user);
  if (!scope) throw Object.assign(new Error('No inbox access'), { status: 403 });
  return scope(db('contact_messages as m'));
}

async function tabCounts(user) {
  const counts = {};
  for (const [key, t] of Object.entries(TABS)) counts[key] = Number((await t.where(base(user)).count({ n: '*' }).first()).n);
  return counts;
}

const PER_PAGE = 25;

async function list(user, { tab = 'new', view = 'all', q = '', type = '', recipient = '', mine = false, unassigned = false, failed = false, page = 1, perPage = PER_PAGE } = {}) {
  const query = TABS[tab].where(base(user));
  if (VIEWS[view] && VIEWS[view].where) VIEWS[view].where(query);
  if (view === 'mine') mine = true;
  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = likeOf(keyword);
    const code = normalizeSearch(keyword);
    query.where((w) => {
      w.where('m.name', 'like', like).orWhere('m.email', 'like', like).orWhere('m.phone', 'like', like).orWhere('m.message', 'like', like);
      orWherePhone(w, 'm.phone', keyword);
      if (code) w.orWhere('m.reference', 'like', `%-${code}`);
    });
  }
  if (TYPE_LABELS[type]) query.where('m.type', type);
  if (RECIPIENT_LABELS[recipient]) query.where('m.recipient', recipient);
  if (unassigned) query.whereNull('m.assigned_to').whereIn('m.status', ['new', 'in_progress']);
  if (failed) query.where('m.email_status', 'failed');
  if (mine) query.where('m.assigned_to', user.id);

  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await query
    .leftJoin('users as a', 'a.id', 'm.assigned_to')
    .select('m.id', 'm.reference', 'm.type', 'm.recipient', 'm.name', 'm.email', 'm.phone', 'm.message', 'm.details', 'm.status', 'm.email_status', 'm.archived_at', 'm.created_at', 'm.assigned_to', 'a.name as assigned_name')
    .orderBy('m.created_at', tab === 'new' ? 'asc' : 'desc') // oldest new message first: it's waited longest
    .orderBy('m.id', 'desc')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { items: items.map(withDetails), total: Number(total), page: current, pages };
}

function withDetails(m) {
  let details = null;
  if (m.details) {
    try {
      details = typeof m.details === 'string' ? JSON.parse(m.details) : m.details;
    } catch {
      details = null;
    }
  }
  return { ...m, details };
}

/** One message, only if this person may see it. */
async function get(user, id) {
  const m = await base(user)
    .leftJoin('users as a', 'a.id', 'm.assigned_to')
    .select('m.*', 'a.name as assigned_name')
    .where('m.id', id)
    .first();
  return m ? withDetails(m) : null;
}

function events(messageId) {
  return db('contact_message_events').where({ message_id: messageId }).orderBy('id', 'desc');
}

function addEvent(messageId, user, kind, body = null, extra = {}) {
  return db('contact_message_events').insert({ message_id: messageId, user_id: user.id, user_name: user.name, kind, body, ...extra });
}

async function setStatus(m, status, user) {
  if (!STATUS_LABELS[status] || m.status === status) return false;
  await db('contact_messages').where({ id: m.id }).update({ status, updated_at: new Date() });
  await addEvent(m.id, user, 'status', `${STATUS_LABELS[m.status]} → ${STATUS_LABELS[status]}`);
  await require('./leads').markContacted(m.lead_id, user);
  return true;
}

async function assign(m, assignee, user) {
  const id = assignee ? assignee.id : null;
  if ((m.assigned_to || null) === id) return false;
  await db('contact_messages').where({ id: m.id }).update({ assigned_to: id, updated_at: new Date() });
  await addEvent(m.id, user, 'assign', assignee ? `Assigned to ${assignee.name}` : 'Unassigned');
  return true;
}

/**
 * Send a message on to another team's inbox (reception passes contact messages to the
 * right person). The message moves to that inbox; the people chosen for it under
 * Roles & permissions → Alerts get a bell alert and an email (no message details).
 * Returns the people told, or null if nothing changed.
 */
async function passOn(m, toKey, user, note = '') {
  if (!RECIPIENT_LABELS[toKey] || toKey === m.recipient) return null;
  await db('contact_messages').where({ id: m.id }).update({ recipient: toKey, updated_at: new Date() });
  await addEvent(m.id, user, 'passed_on', `Sent to ${RECIPIENT_LABELS[toKey]}${note ? `: ${note}` : ''}`);
  const config = require('../config');
  const { notify } = require('./notify');
  const people = (await require('./alerts').peopleFor(`message_${toKey}`)).filter((p) => p.id !== user.id);
  const kind = TYPE_LABELS[m.type].toLowerCase();
  const title = `${user.name} sent you a ${kind}`;
  await Promise.all(people.map((p) => require('./notifications').notifyUser(p.id, { type: m.type, title, body: note ? `“${note.slice(0, 140)}”` : `From ${m.name}`, link: `/portal/messages/${m.id}` })));
  await Promise.all(people.filter((p) => p.email).map((p) => notify({
    to: p.email,
    subject: `${title} (${ref(m)})`,
    text: [
      `Hello ${p.name.split(' ')[0]},`,
      '',
      `${user.name} passed a ${kind} from the website (${ref(m)}) to the ${RECIPIENT_LABELS[toKey]} inbox.`,
      ...(note ? ['', `Their note: ${note}`] : []),
      '',
      'The details stay in the staff portal.',
    ].join('\n'),
    cta: { label: 'Open it in the staff portal', href: `${config.appUrl}/portal/messages/${m.id}` },
    footnote: 'Sent by the HLO staff portal because your role is told about messages passed to this inbox (Roles & permissions → Alerts).',
  })));
  return people;
}

/** Staff who work from the inbox, for the "Assign to" list. Assigning a message lets that person see it. */
async function assignableStaff() {
  const { MESSAGE_ACCESS } = require('../auth/permissions');
  const roles = await require('./roles').list();
  const keys = roles.filter((r) => MESSAGE_ACCESS.some((p) => r.permissions.has(p))).map((r) => r.key);
  if (!keys.length) return [];
  return db('users').whereIn('role', keys).where({ status: 'active' }).select('id', 'name', 'email').orderBy('name');
}

/** Email a reply to the sender (plain text), and keep a copy in the history. */
/**
 * Email a reply. `html` (optional) is the formatted version from the editor, already
 * cleaned by lib/richText; `text` is always the plain-text version.
 */
async function reply(m, user, text, html = null) {
  const business = await content.getBusiness();
  const from = await content.getRecipientEmail(m.recipient);
  const sentOn = new Date(m.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' });
  let bodyHtml = null;
  if (html) {
    const { forEmail } = require('../lib/richText');
    const { escape } = require('../lib/emailLayout');
    const p = (s, extra = '') => `<p style="margin:0 0 16px;color:#0f1c16;font-size:15px;line-height:1.65${extra}">${s}</p>`;
    bodyHtml = [
      p(`Hello ${escape(m.name)},`),
      forEmail(html),
      p(`${escape(user.name)}<br>${escape(business.legalName)}<br>${escape(business.phone)} · ${escape(business.hours)}`),
      `<div style="margin:24px 0 8px;padding-top:14px;border-top:1px solid #dfe8e3;color:#475950;font-size:13px">Your ${escape(KIND[m.type] || 'message')} (sent ${escape(sentOn)}):</div>`,
      `<blockquote style="margin:0 0 16px;padding:4px 0 4px 14px;border-left:3px solid #dfe8e3;color:#475950;font-size:14px;line-height:1.6;white-space:pre-line">${escape(String(m.message))}</blockquote>`,
    ].join('\n');
  }
  const result = await notify({
    to: m.email,
    replyTo: from,
    subject: `Re: your ${KIND[m.type] || 'message'} to ${business.legalName} (ref ${ref(m)})`,
    html: bodyHtml,
    text: [
      `Hello ${m.name},`,
      '',
      text,
      '',
      user.name,
      business.legalName,
      `${business.phone} · ${business.hours}`,
      '',
      '---',
      `Your ${KIND[m.type] || 'message'} (sent ${sentOn}):`,
      ...String(m.message).split('\n').map((line) => `> ${line}`),
    ].join('\n'),
  });
  await addEvent(m.id, user, 'reply', text, { email_status: result.ok ? 'sent' : 'failed', body_html: html || null });
  if (result.ok && m.status === 'new') await setStatus(m, 'in_progress', user);
  else if (result.ok) await require('./leads').markContacted(m.lead_id, user);
  return result.ok;
}

/** Send the staff email again (when the first one failed). */
async function resendToTeam(m) {
  const to = await content.getRecipientEmail(m.recipient);
  const d = m.details || {};
  const lines =
    m.type === 'referral'
      ? [
          `Referral from the HLO website (reference ${ref(m)}), re-sent from the staff portal.`,
          '',
          `Referred by: ${m.name} <${m.email}>${m.phone ? `, ${m.phone}` : ''}`,
          `Person being referred: ${d.person_name || 'Not given'} (${d.county || 'county not given'})`,
          '',
          `Notes: ${m.message}`,
        ]
      : [
          `Message from the HLO website (reference ${ref(m)}), re-sent from the staff portal.`,
          '',
          `To: ${RECIPIENT_LABELS[m.recipient] || m.recipient}`,
          `From: ${m.name} <${m.email}>${m.phone ? `, ${m.phone}` : ''}`,
          '',
          m.message,
        ];
  const result = await notify({
    to,
    replyTo: m.email,
    subject: `${m.type === 'referral' ? 'Referral' : m.type === 'request' ? 'Service request' : 'Website message'} ${ref(m)} from ${m.name}`,
    text: lines.join('\n'),
  });
  await db('contact_messages').where({ id: m.id }).update({ email_status: result.ok ? 'sent' : 'failed' });
  return result.ok;
}

function setArchived(m, archived) {
  return db('contact_messages').where({ id: m.id }).update({ archived_at: archived ? new Date() : null, updated_at: new Date() });
}

function remove(m) {
  return db('contact_messages').where({ id: m.id }).del();
}

module.exports = {
  VIEWS,
  passOn,
  inboxesFor,
  detailRows,
  STATUS_LABELS,
  TYPE_LABELS,
  RECIPIENT_LABELS,
  TABS,
  scopeFor,
  tabCounts,
  list,
  get,
  events,
  addEvent,
  setStatus,
  assign,
  assignableStaff,
  reply,
  resendToTeam,
  setArchived,
  remove,
};
