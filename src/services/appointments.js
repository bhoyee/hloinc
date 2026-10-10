'use strict';

const db = require('../db/knex');

const STATUS_LABELS = {
  requested: 'Requested',
  confirmed: 'Confirmed',
  completed: 'Completed',
  cancelled: 'Cancelled',
  no_show: 'No-show',
};
const SOURCE_LABELS = { website: 'Website request', walk_in: 'Walk-in', phone: 'Phone' };
const WINDOW_LABELS = { morning: 'Morning (9 a.m.–12 p.m.)', afternoon: 'Afternoon (12–5 p.m.)' };

/** Which status changes are allowed, and from where. */
const TRANSITIONS = {
  confirm: ['requested', 'confirmed'], // confirming a request, or rescheduling
  complete: ['confirmed'],
  no_show: ['confirmed'],
  reopen: ['completed', 'no_show', 'cancelled'], // undo an outcome or cancellation
  cancel: ['requested', 'confirmed'],
};

const PER_PAGE = 20;
const DEFAULT_DURATION = 30;

function base() {
  return db('appointments as a')
    .leftJoin('appointment_types as t', 't.id', 'a.type_id')
    .leftJoin('users as u', 'u.id', 'a.assigned_to')
    .select(
      'a.*',
      't.name as type_name',
      't.duration_minutes as type_duration',
      't.capacity as type_capacity',
      'u.name as assigned_name'
    );
}

const { insertWithReference, normalizeSearch } = require('../lib/reference');

const likeOf = (q) => `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;

/** Tabs on the appointments screen. */
const TABS = {
  requests: { label: 'Requests', apply: (q) => q.where('a.status', 'requested').orderBy('a.created_at', 'asc') },
  upcoming: {
    label: 'Upcoming',
    apply: (q) => q.where('a.status', 'confirmed').where('a.scheduled_at', '>=', new Date()).orderBy('a.scheduled_at', 'asc'),
  },
  outcome: {
    label: 'Needs outcome',
    apply: (q) => q.where('a.status', 'confirmed').where('a.scheduled_at', '<', new Date()).orderBy('a.scheduled_at', 'desc'),
  },
  all: { label: 'All', apply: (q) => q.orderByRaw('COALESCE(a.scheduled_at, a.created_at) DESC') },
};

async function tabCounts() {
  const counts = {};
  for (const [key, tab] of Object.entries(TABS)) {
    if (key === 'all') continue;
    const q = tab.apply(db('appointments as a')).clearOrder();
    counts[key] = Number((await q.count({ n: '*' }).first()).n);
  }
  return counts;
}

async function list({ tab = 'requests', q = '', status = '', type = '', source = '', page = 1, perPage = PER_PAGE } = {}) {
  const query = base();
  TABS[tab].apply(query);
  if (q) {
    const code = normalizeSearch(q);
    query.where((w) => {
      w.where('a.name', 'like', likeOf(q)).orWhere('a.email', 'like', likeOf(q)).orWhere('a.phone', 'like', likeOf(q))
        .orWhere('u.name', 'like', likeOf(q));
      if (code) w.orWhere('a.reference', 'like', `%-${code}`);
    });
  }
  if (status && STATUS_LABELS[status]) query.where('a.status', status);
  if (type) query.where('a.type_id', Number(type));
  if (source && SOURCE_LABELS[source]) query.where('a.source', source);

  const counter = query.clone().clearSelect().clearOrder().count({ total: '*' }).first();
  const total = Number((await counter).total);
  const pages = Math.max(1, Math.ceil(total / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await query.limit(perPage).offset((current - 1) * perPage);
  return { items, total, page: current, pages };
}

const get = (id) => base().where('a.id', id).first();

/** Booked appointments (not cancelled, not still requests) between two instants, for the calendar. */
/**
 * Scheduled appointments in [from, to), optionally narrowed by a search (the
 * person, their contact details, the reference, or the staff member it's with)
 * and a type.
 */
function between(from, to, { q = '', type = '' } = {}) {
  const query = base()
    .whereIn('a.status', ['confirmed', 'completed', 'no_show'])
    .where('a.scheduled_at', '>=', from)
    .where('a.scheduled_at', '<', to)
    .orderBy('a.scheduled_at');
  if (q) {
    const code = normalizeSearch(q);
    query.where((w) => {
      w.where('a.name', 'like', likeOf(q)).orWhere('a.email', 'like', likeOf(q)).orWhere('a.phone', 'like', likeOf(q))
        .orWhere('u.name', 'like', likeOf(q));
      if (code) w.orWhere('a.reference', 'like', `%-${code}`);
    });
  }
  if (type) query.where('a.type_id', Number(type));
  return query;
}

/** Requests not yet scheduled, oldest first. */
function waiting(limit = 20) {
  return base().where('a.status', 'requested').orderBy('a.created_at', 'asc').limit(limit);
}

/**
 * Other confirmed appointments of the same type that overlap [start, end).
 * The type's capacity says how many can run at once.
 */
async function overlapping(typeId, start, durationMinutes, excludeId) {
  const end = new Date(start.getTime() + durationMinutes * 60 * 1000);
  const q = db('appointments')
    .where({ type_id: typeId, status: 'confirmed' })
    .where('scheduled_at', '<', end)
    .whereRaw('DATE_ADD(scheduled_at, INTERVAL COALESCE(duration_minutes, ?) MINUTE) > ?', [DEFAULT_DURATION, start]);
  if (excludeId) q.whereNot({ id: excludeId });
  return Number((await q.count({ n: '*' }).first()).n);
}

/** Change status if the move is allowed. Returns the updated row, or null if not allowed. */
async function transition(id, action, changes = {}) {
  const current = await db('appointments').where({ id }).first();
  if (!current || !TRANSITIONS[action].includes(current.status)) return null;
  const status = { confirm: 'confirmed', complete: 'completed', no_show: 'no_show', cancel: 'cancelled', reopen: null }[action];
  const next = status || (current.scheduled_at ? 'confirmed' : 'requested');
  await db('appointments').where({ id }).update({ ...changes, status: next });
  return get(id);
}

async function create(row) {
  const { id } = await insertWithReference(db, 'appointments', row, 'appointment');
  return get(id);
}

const updateNotes = (id, staffNotes) => db('appointments').where({ id }).update({ staff_notes: staffNotes || null });
const remove = (id) => db('appointments').where({ id }).del();

/** Active staff, for the "assigned to" picker. */
const staffOptions = () => db('users').select('id', 'name').where({ status: 'active' }).orderBy('name');

module.exports = {
  STATUS_LABELS,
  SOURCE_LABELS,
  WINDOW_LABELS,
  TABS,
  TRANSITIONS,
  DEFAULT_DURATION,
  tabCounts,
  list,
  PER_PAGE,
  get,
  between,
  waiting,
  overlapping,
  transition,
  create,
  updateNotes,
  remove,
  staffOptions,
};
