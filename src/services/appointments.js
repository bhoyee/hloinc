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
const { orWherePhone } = require('../validation/phone');

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
      orWherePhone(w, 'a.phone', q);
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
      orWherePhone(w, 'a.phone', q);
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

/**
 * The dashboard's appointments widget: a week strip or a compact month grid with
 * the number of booked appointments per day, and the appointments of one chosen day.
 * `date` picks the week/month shown; `day` the day listed (defaults to today, or the
 * first day shown).
 */
async function widget({ view = 'week', date, day } = {}, now = new Date()) {
  const { marylandParts, marylandDateTime, addDaysIso, weekStartIso, isIsoDate } = require('../lib/hours');
  const today = marylandParts(now).date;
  const anchor = isIsoDate(date) ? date : today;
  const fmt = (d, opts) => new Date(`${d}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
  let first;
  let count;
  let prev;
  let next;
  let label;
  let month = null;
  if (view === 'month') {
    month = anchor.slice(0, 7);
    const monthStart = `${month}-01`;
    const nextMonth = `${addDaysIso(monthStart, 32).slice(0, 7)}-01`;
    first = weekStartIso(monthStart);
    const lastShown = addDaysIso(weekStartIso(addDaysIso(nextMonth, -1)), 6);
    count = Math.round((new Date(`${lastShown}T12:00:00Z`) - new Date(`${first}T12:00:00Z`)) / 86400000) + 1;
    prev = `${addDaysIso(monthStart, -1).slice(0, 7)}-01`;
    next = nextMonth;
    label = fmt(monthStart, { month: 'long', year: 'numeric' });
  } else {
    view = 'week';
    first = weekStartIso(anchor);
    count = 7;
    prev = addDaysIso(first, -7);
    next = addDaysIso(first, 7);
    label = `${fmt(first, { month: 'short', day: 'numeric' })} – ${fmt(addDaysIso(first, 6), { month: 'short', day: 'numeric', year: 'numeric' })}`;
  }
  const dates = Array.from({ length: count }, (_, i) => addDaysIso(first, i));
  const inRange = (d) => isIsoDate(d) && dates.includes(d) && (!month || d.startsWith(month));
  const selected = inRange(day) ? day : inRange(today) ? today : month ? `${month}-01` : first;

  const items = await between(marylandDateTime(first, '00:00'), marylandDateTime(addDaysIso(first, count), '00:00'));
  const perDay = {};
  for (const a of items) (perDay[marylandParts(a.scheduled_at).date] ||= []).push(a);
  const time = (d) => new Date(d).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' });

  return {
    view,
    date: anchor,
    today,
    label,
    prev,
    next,
    selected,
    selectedLabel: fmt(selected, { weekday: 'long', month: 'long', day: 'numeric' }),
    weekdays: ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'],
    cells: dates.map((d) => ({
      date: d,
      dayNum: Number(d.slice(8)),
      dow: fmt(d, { weekday: 'short' }),
      inMonth: !month || d.startsWith(month),
      isToday: d === today,
      isSelected: d === selected,
      count: (perDay[d] || []).length,
    })),
    total: items.filter((a) => !month || marylandParts(a.scheduled_at).date.startsWith(month)).length,
    dayItems: (perDay[selected] || []).map((a) => {
      const minutes = a.duration_minutes || a.type_duration || 30;
      return {
        id: a.id,
        name: a.name,
        type: a.type_name,
        status: a.status,
        statusLabel: STATUS_LABELS[a.status],
        source: SOURCE_LABELS[a.source],
        staff: a.assigned_name,
        phone: a.phone,
        email: a.email,
        notes: a.notes ? String(a.notes).slice(0, 160) : '',
        from: time(a.scheduled_at),
        until: time(new Date(new Date(a.scheduled_at).getTime() + minutes * 60000)),
        past: new Date(a.scheduled_at) < now,
        href: `/portal/appointments/${a.id}`,
      };
    }),
    waiting: Number((await db('appointments').where({ status: 'requested' }).count({ n: '*' }).first()).n),
  };
}

// --- Reminders the day before -----------------------------------------------------------------

const REMINDER_FROM_HOUR = 10; // Maryland time, the day before
const REMINDER_TRIES = 3;

/**
 * Email a reminder for each confirmed appointment tomorrow (Maryland time), from
 * 10 a.m. today. Once per appointment time: if it's moved to another day, a new
 * reminder goes for the new time. Failed sends are tried again, up to 3 times.
 * Returns { sent, failed }.
 */
async function sendReminders(now = new Date()) {
  if (!require('../config').appointments.reminders) return { sent: 0, failed: 0 };
  const { marylandParts, marylandDateTime, addDaysIso } = require('../lib/hours');
  const today = marylandParts(now);
  if (today.hour < REMINDER_FROM_HOUR) return { sent: 0, failed: 0 };
  const tomorrow = addDaysIso(today.date, 1);
  const due = await base()
    .where('a.status', 'confirmed')
    .whereNotNull('a.email').whereNot('a.email', '')
    .where('a.scheduled_at', '>=', marylandDateTime(tomorrow, '00:00'))
    .where('a.scheduled_at', '<', marylandDateTime(addDaysIso(tomorrow, 1), '00:00'))
    .where((w) => w.whereNull('a.reminder_for')
      .orWhereRaw('a.reminder_for <> a.scheduled_at')
      .orWhere((f) => f.where('a.reminder_status', 'failed').where('a.reminder_attempts', '<', REMINDER_TRIES)))
    .limit(100);
  const emails = require('./appointmentEmails');
  let sent = 0;
  let failed = 0;
  for (const a of due) {
    const result = await emails.reminder(a);
    const sameTime = a.reminder_for && new Date(a.reminder_for).getTime() === new Date(a.scheduled_at).getTime();
    await db('appointments').where({ id: a.id }).update({
      reminder_for: db.ref('scheduled_at'), // copied in SQL, so it compares exactly
      reminder_at: db.fn.now(),
      reminder_status: result.ok ? 'sent' : 'failed',
      reminder_attempts: (sameTime ? a.reminder_attempts : 0) + 1,
    });
    if (result.ok) sent += 1;
    else failed += 1;
  }
  return { sent, failed };
}

/** Check every 15 minutes while the app runs (not in tests). */
function startReminders() {
  if (require('../config').isTest) return;
  const run = () => sendReminders().catch((err) => console.error('Appointment reminders failed:', err.message));
  setTimeout(run, 3 * 60 * 1000).unref();
  setInterval(run, 15 * 60 * 1000).unref();
}

module.exports = {
  sendReminders,
  startReminders,
  widget,
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
