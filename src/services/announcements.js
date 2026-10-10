'use strict';

const db = require('../db/knex');

/*
 * Announcements (requirements §5.4): shown on the public website, on the
 * internal staff board (portal dashboard), or both, between their start and
 * end dates. Paused ones are hidden until resumed. Deleted ones (the
 * archived_at column) are hidden everywhere; an Admin can restore them.
 */
const { can } = require('../auth/permissions');

const AUDIENCE_LABELS = { public: 'Website', internal: 'Staff only', both: 'Website and staff' };
const STATE_LABELS = { live: 'Live', paused: 'Paused', scheduled: 'Scheduled', expired: 'Ended', archived: 'Deleted' };

/** Live right now: started, not ended, not paused, not deleted. */
function live(query, now = new Date()) {
  return query
    .whereNull('archived_at')
    .whereNull('paused_at')
    .where('starts_at', '<=', now)
    .where((q) => q.whereNull('ends_at').orWhere('ends_at', '>', now));
}

const TABS = {
  live: { label: 'Live', where: (q, now) => live(q, now) },
  paused: { label: 'Paused', where: (q, now) => q.whereNull('archived_at').whereNotNull('paused_at').where((w) => w.whereNull('ends_at').orWhere('ends_at', '>', now)) },
  scheduled: { label: 'Scheduled', where: (q, now) => q.whereNull('archived_at').whereNull('paused_at').where('starts_at', '>', now) },
  expired: { label: 'Ended', where: (q, now) => q.whereNull('archived_at').whereNotNull('ends_at').where('ends_at', '<=', now) },
  archived: { label: 'Deleted', where: (q) => q.whereNotNull('archived_at') },
  all: { label: 'All', where: (q) => q },
};

/** Public announcements currently within their start/end dates (§5.4). */
async function activePublic(limit = 3) {
  try {
    return await live(db('announcements'))
      .select('id', 'title', 'body', 'link_url', 'link_label', 'starts_at')
      .whereIn('audience', ['public', 'both'])
      .orderBy('starts_at', 'desc')
      .limit(limit);
  } catch (err) {
    console.error('Could not load announcements:', err.message);
    return [];
  }
}

/** The staff board: live internal announcements, newest first. */
function activeInternal(limit = 5) {
  return live(db('announcements as a'))
    .leftJoin('users as u', 'u.id', 'a.created_by')
    .select('a.id', 'a.title', 'a.body', 'a.link_url', 'a.link_label', 'a.starts_at', 'a.ends_at', 'u.name as author')
    .whereIn('a.audience', ['internal', 'both'])
    .orderBy('a.starts_at', 'desc')
    .limit(limit);
}

/**
 * Every live announcement (website, staff or both), newest first, for the
 * staff board. People who can edit also see paused ones, so they can resume them.
 */
async function activeForStaff(limit = 20, { includePaused = false } = {}) {
  const now = new Date();
  const q = db('announcements as a')
    .leftJoin('users as u', 'u.id', 'a.created_by')
    .select('a.id', 'a.title', 'a.body', 'a.audience', 'a.link_url', 'a.link_label', 'a.starts_at', 'a.ends_at', 'a.paused_at', 'a.created_by', 'u.name as author')
    .whereNull('a.archived_at')
    .where('a.starts_at', '<=', now)
    .where((w) => w.whereNull('a.ends_at').orWhere('a.ends_at', '>', now))
    .orderByRaw('a.paused_at IS NOT NULL')
    .orderBy('a.starts_at', 'desc')
    .limit(limit);
  if (!includePaused) q.whereNull('a.paused_at');
  return q;
}

/** Can this person delete it? Their own posts, or anyone's with the full delete permission. */
function canDelete(user, a) {
  return can(user, 'announcements.delete') || (can(user, 'announcements.archive') && a.created_by === user.id);
}

function stateOf(a, now = new Date()) {
  if (a.archived_at) return 'archived';
  if (a.ends_at && new Date(a.ends_at) <= now) return 'expired';
  if (a.paused_at) return 'paused';
  if (new Date(a.starts_at) > now) return 'scheduled';
  if (a.ends_at && new Date(a.ends_at) <= now) return 'expired';
  return 'live';
}

async function tabCounts() {
  const now = new Date();
  const counts = {};
  for (const [key, t] of Object.entries(TABS)) {
    counts[key] = Number((await t.where(db('announcements'), now).count({ n: '*' }).first()).n);
  }
  return counts;
}

const PER_PAGE = 20;

async function list({ tab = 'live', q = '', page = 1, perPage = PER_PAGE } = {}) {
  const now = new Date();
  const query = TABS[tab].where(db('announcements as a'), now);
  const keyword = String(q).trim().slice(0, 100);
  if (keyword) {
    const like = `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    query.where((w) => w.where('a.title', 'like', like).orWhere('a.body', 'like', like));
  }
  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await query
    .leftJoin('users as u', 'u.id', 'a.created_by')
    .select('a.*', 'u.name as author')
    .orderBy(tab === 'scheduled' ? 'a.starts_at' : 'a.updated_at', tab === 'scheduled' ? 'asc' : 'desc')
    .orderBy('a.id', 'desc')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { items: items.map((a) => ({ ...a, state: stateOf(a, now) })), total: Number(total), page: current, pages };
}

async function get(id) {
  const a = await db('announcements as a')
    .leftJoin('users as c', 'c.id', 'a.created_by')
    .leftJoin('users as u', 'u.id', 'a.updated_by')
    .select('a.*', 'c.name as author', 'u.name as updated_by_name')
    .where('a.id', id)
    .first();
  return a ? { ...a, state: stateOf(a) } : null;
}

async function create(data, user) {
  const [id] = await db('announcements').insert({ ...data, created_by: user.id, updated_by: user.id });
  return get(id);
}

async function update(id, data, user) {
  await db('announcements').where({ id }).update({ ...data, updated_by: user.id, updated_at: new Date() });
  return get(id);
}

/** End now: stays on record under "Ended". */
async function endNow(id, user) {
  // A second in the past: MySQL rounds to whole seconds, which could otherwise keep it live briefly.
  await db('announcements').where({ id }).update({ ends_at: new Date(Date.now() - 1000), updated_by: user.id, updated_at: new Date() });
  return get(id);
}

async function setPaused(id, paused, user) {
  await db('announcements').where({ id }).update({ paused_at: paused ? new Date() : null, updated_by: user.id, updated_at: new Date() });
  return get(id);
}

async function setArchived(id, archived, user) {
  await db('announcements').where({ id }).update({ archived_at: archived ? new Date() : null, updated_by: user.id, updated_at: new Date() });
  return get(id);
}

function remove(id) {
  return db('announcements').where({ id }).del();
}

module.exports = {
  AUDIENCE_LABELS,
  STATE_LABELS,
  TABS,
  activePublic,
  activeInternal,
  activeForStaff,
  canDelete,
  setPaused,
  stateOf,
  tabCounts,
  list,
  get,
  create,
  update,
  endNow,
  setArchived,
  remove,
};
