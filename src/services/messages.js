'use strict';

const db = require('../db/knex');
const { can } = require('../auth/permissions');
const { recipients } = require('../lib/site');
const { notify } = require('./notify');
const content = require('./content');

/*
 * The contacts inbox (requirements §5.5): website messages and referrals,
 * routed by the recipient the sender chose. Statuses New → In progress →
 * Resolved, internal notes, email replies, and a history of every change.
 */

const STATUS_LABELS = { new: 'New', in_progress: 'In progress', resolved: 'Resolved' };
const TYPE_LABELS = { message: 'Message', referral: 'Referral' };
const RECIPIENT_LABELS = Object.fromEntries(recipients.map((r) => [r.key, r.label]));

const TABS = {
  new: { label: 'New', where: (q) => q.whereNull('m.archived_at').where('m.status', 'new') },
  in_progress: { label: 'In progress', where: (q) => q.whereNull('m.archived_at').where('m.status', 'in_progress') },
  resolved: { label: 'Resolved', where: (q) => q.whereNull('m.archived_at').where('m.status', 'resolved') },
  archived: { label: 'Archived', where: (q) => q.whereNotNull('m.archived_at') },
  all: { label: 'All', where: (q) => q },
};

/**
 * Which messages this person may see: everything, the intake inbox only
 * (intake messages and referrals), or nothing. Returns a query modifier or null.
 */
function scopeFor(user) {
  if (can(user, 'messages.view')) return (q) => q;
  if (can(user, 'messages.view_intake')) return (q) => q.where('m.recipient', 'intake');
  return null;
}

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

async function list(user, { tab = 'new', q = '', type = '', recipient = '', mine = false, page = 1 } = {}) {
  const query = TABS[tab].where(base(user));
  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = likeOf(keyword);
    query.where((w) => w.where('m.name', 'like', like).orWhere('m.email', 'like', like).orWhere('m.phone', 'like', like).orWhere('m.message', 'like', like));
  }
  if (TYPE_LABELS[type]) query.where('m.type', type);
  if (RECIPIENT_LABELS[recipient]) query.where('m.recipient', recipient);
  if (mine) query.where('m.assigned_to', user.id);

  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / PER_PAGE));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await query
    .leftJoin('users as a', 'a.id', 'm.assigned_to')
    .select('m.id', 'm.type', 'm.recipient', 'm.name', 'm.email', 'm.phone', 'm.message', 'm.details', 'm.status', 'm.email_status', 'm.archived_at', 'm.created_at', 'm.assigned_to', 'a.name as assigned_name')
    .orderBy('m.created_at', tab === 'new' ? 'asc' : 'desc') // oldest new message first: it's waited longest
    .orderBy('m.id', 'desc')
    .limit(PER_PAGE)
    .offset((current - 1) * PER_PAGE);
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
  return true;
}

async function assign(m, assignee, user) {
  const id = assignee ? assignee.id : null;
  if ((m.assigned_to || null) === id) return false;
  await db('contact_messages').where({ id: m.id }).update({ assigned_to: id, updated_at: new Date() });
  await addEvent(m.id, user, 'assign', assignee ? `Assigned to ${assignee.name}` : 'Unassigned');
  return true;
}

/** Staff who can see this message, for the "Assign to" list. */
async function assignableStaff(m) {
  const roles = await require('./roles').list();
  const keys = roles
    .filter((r) => r.permissions.has('messages.view') || (m.recipient === 'intake' && r.permissions.has('messages.view_intake')))
    .map((r) => r.key);
  if (!keys.length) return [];
  return db('users').whereIn('role', keys).where({ status: 'active' }).select('id', 'name').orderBy('name');
}

/** Email a reply to the sender (plain text), and keep a copy in the history. */
async function reply(m, user, text) {
  const business = await content.getBusiness();
  const from = await content.getRecipientEmail(m.recipient);
  const result = await notify({
    to: m.email,
    replyTo: from,
    subject: m.type === 'referral' ? `Re: your referral to ${business.legalName} (ref #${m.id})` : `Re: your message to ${business.legalName} (ref #${m.id})`,
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
      `Your ${m.type === 'referral' ? 'referral' : 'message'} (sent ${new Date(m.created_at).toLocaleDateString('en-US', { month: 'long', day: 'numeric', year: 'numeric', timeZone: 'America/New_York' })}):`,
      ...String(m.message).split('\n').map((line) => `> ${line}`),
    ].join('\n'),
  });
  await addEvent(m.id, user, 'reply', text, { email_status: result.ok ? 'sent' : 'failed' });
  if (result.ok && m.status === 'new') await setStatus(m, 'in_progress', user);
  return result.ok;
}

/** Send the staff email again (when the first one failed). */
async function resendToTeam(m) {
  const to = await content.getRecipientEmail(m.recipient);
  const d = m.details || {};
  const lines =
    m.type === 'referral'
      ? [
          `Referral from the HLO website (reference #${m.id}), re-sent from the staff portal.`,
          '',
          `Referred by: ${m.name} <${m.email}>${m.phone ? `, ${m.phone}` : ''}`,
          `Person being referred: ${d.person_name || 'Not given'} (${d.county || 'county not given'})`,
          '',
          `Notes: ${m.message}`,
        ]
      : [
          `Message from the HLO website (reference #${m.id}), re-sent from the staff portal.`,
          '',
          `To: ${RECIPIENT_LABELS[m.recipient] || m.recipient}`,
          `From: ${m.name} <${m.email}>${m.phone ? `, ${m.phone}` : ''}`,
          '',
          m.message,
        ];
  const result = await notify({
    to,
    replyTo: m.email,
    subject: `${m.type === 'referral' ? 'Referral' : 'Website message'} #${m.id} from ${m.name}`,
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
