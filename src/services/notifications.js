'use strict';

const db = require('../db/knex');
const roles = require('./roles');

/**
 * In-app notifications (the bell in the portal header). Never throws:
 * a notification failing must not break the action that caused it.
 */

async function insert(userIds, { type, title, body, link }) {
  if (!userIds.length) return;
  try {
    await db('notifications').insert(
      userIds.map((user_id) => ({ user_id, type, title: title.slice(0, 160), body: body ? body.slice(0, 500) : null, link: link || null }))
    );
  } catch (err) {
    console.error('Notification write failed:', err.message);
  }
}

/** Notify one person (e.g. a security alert about their own account). */
function notifyUser(userId, payload) {
  return insert([userId], payload);
}

/**
 * Notify every active staff member whose role has any of `permissions`.
 * Example: a new referral goes to anyone who can view all messages or
 * intake messages.
 */
async function notifyPermission(permissions, payload) {
  try {
    const wanted = [].concat(permissions);
    const roleKeys = (await roles.list()).filter((r) => wanted.some((p) => r.permissions.has(p))).map((r) => r.key);
    if (!roleKeys.length) return;
    const ids = await db('users').whereIn('role', roleKeys).where({ status: 'active' }).pluck('id');
    await insert(ids, payload);
  } catch (err) {
    console.error('Notification fan-out failed:', err.message);
  }
}

/** Notify every active staff member (except `exceptId`, usually whoever caused it). */
async function notifyAllStaff(payload, { exceptId = null } = {}) {
  try {
    const ids = await db('users').where({ status: 'active' }).modify((q) => exceptId && q.whereNot({ id: exceptId })).pluck('id');
    await insert(ids, payload);
  } catch (err) {
    console.error('Notification fan-out failed:', err.message);
  }
}

function unreadCount(userId) {
  return db('notifications').where({ user_id: userId }).whereNull('read_at').count({ n: '*' }).first().then((r) => Number(r.n));
}

function latest(userId, limit = 8) {
  return db('notifications').where({ user_id: userId }).orderBy('id', 'desc').limit(limit);
}

async function page(userId, { page = 1, perPage = 25 } = {}) {
  const { total } = await db('notifications').where({ user_id: userId }).count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const items = await db('notifications').where({ user_id: userId }).orderBy('id', 'desc').limit(perPage).offset((current - 1) * perPage);
  return { items, total: Number(total), page: current, pages };
}

/** Mark one as read (only if it belongs to the user). Returns the row or null. */
async function markRead(userId, id) {
  const row = await db('notifications').where({ id, user_id: userId }).first();
  if (!row) return null;
  if (!row.read_at) await db('notifications').where({ id }).update({ read_at: db.fn.now() });
  return row;
}

function markAllRead(userId) {
  return db('notifications').where({ user_id: userId }).whereNull('read_at').update({ read_at: db.fn.now() });
}

module.exports = { notifyUser, notifyPermission, notifyAllStaff, unreadCount, latest, page, markRead, markAllRead };
