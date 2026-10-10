'use strict';

/*
 * Red counters on the portal menu:
 *   Messages      messages still open (new or in progress) that THIS person
 *                 hasn't opened yet, within the inbox their role can see.
 *                 Goes down when they open one, or for everyone when someone
 *                 resolves or archives it.
 *   Appointments  website requests waiting to be confirmed (shared by the
 *                 team). Goes down when someone confirms or cancels one.
 *   Schedule      time-off requests waiting for this person to decide on.
 *   Applications  job applications nobody has opened yet.
 * Refreshed with each page and every 30 seconds by the notification poll.
 */
const db = require('../db/knex');
const { can } = require('../auth/permissions');
const messages = require('./messages');

async function unreadMessages(user) {
  const scope = messages.scopeFor(user);
  if (!scope) return null;
  const row = await scope(db('contact_messages as m'))
    .whereNull('m.archived_at')
    .whereIn('m.status', ['new', 'in_progress'])
    .whereNotExists(db('message_reads as r').whereRaw('r.message_id = m.id').where('r.user_id', user.id))
    .count({ n: '*' })
    .first();
  return Number(row.n);
}

async function waitingRequests(user) {
  if (!can(user, 'appointments.view')) return null;
  const row = await db('appointments').where({ status: 'requested' }).count({ n: '*' }).first();
  return Number(row.n);
}

/** { messages, appointments, timeOff, applications } for this person (null where their role has no access). */
async function forUser(user) {
  const [m, a, t, j] = await Promise.all([unreadMessages(user), waitingRequests(user), require('./timeOff').pendingFor(user), require('./applications').newCount(user)]);
  return { messages: m, appointments: a, timeOff: t, applications: j };
}

/** Record that this person has opened a message. */
function markRead(messageId, userId) {
  return db('message_reads').insert({ message_id: messageId, user_id: userId }).onConflict(['message_id', 'user_id']).ignore();
}

/** Mark every message this person can see as read. */
async function markAllRead(user) {
  const scope = messages.scopeFor(user);
  if (!scope) return 0;
  const ids = await scope(db('contact_messages as m'))
    .whereNull('m.archived_at')
    .whereNotExists(db('message_reads as r').whereRaw('r.message_id = m.id').where('r.user_id', user.id))
    .pluck('m.id');
  if (ids.length) await db('message_reads').insert(ids.map((id) => ({ message_id: id, user_id: user.id }))).onConflict(['message_id', 'user_id']).ignore();
  return ids.length;
}

module.exports = { forUser, markRead, markAllRead };
