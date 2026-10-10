'use strict';

const bcrypt = require('bcryptjs');
const db = require('../db/knex');
const config = require('../config');
const { ADMIN_ROLE } = require('../auth/permissions');

const PUBLIC_COLUMNS = [
  'id',
  'name',
  'email',
  'phone',
  'role',
  'status',
  'session_version',
  'must_change_password',
  'mfa_enabled',
  'last_login_at',
  'page_size',
  'password_changed_at',
  'deactivated_at',
  'created_at',
  'updated_at',
];

// Compared against when the email is unknown, so a wrong email takes as long as a wrong password.
const DUMMY_HASH = bcrypt.hashSync('not-a-real-password', config.auth.bcryptRounds);

const hashPassword = (password) => bcrypt.hash(password, config.auth.bcryptRounds);

const normalizeEmail = (email) => String(email || '').trim().toLowerCase();

function findById(id) {
  return db('users').select(PUBLIC_COLUMNS).where({ id }).first();
}

function findByEmail(email) {
  return db('users').select(PUBLIC_COLUMNS).where({ email: normalizeEmail(email) }).first();
}

/** Includes secrets — only for the sign-in and MFA services. */
function findWithSecrets(id) {
  return db('users').where({ id }).first();
}

/**
 * Check an email and password. Locks the account for a while after too many
 * failures. Always returns the same failure reason, so callers can't tell
 * "no such account", "wrong password", "locked" and "deactivated" apart.
 *
 * @returns {Promise<{ user?: object, reason?: string }>}
 */
async function authenticate(email, password) {
  const row = await db('users').where({ email: normalizeEmail(email) }).first();
  if (!row) {
    await bcrypt.compare(String(password), DUMMY_HASH);
    return { reason: 'unknown' };
  }

  const matches = await bcrypt.compare(String(password), row.password_hash);
  const locked = row.locked_until && new Date(row.locked_until) > new Date();

  if (locked) return { reason: 'locked', userId: row.id };
  if (!matches) {
    const failures = row.failed_login_count + 1;
    const lock = failures >= config.auth.maxFailedLogins;
    await db('users')
      .where({ id: row.id })
      .update({
        failed_login_count: lock ? 0 : failures,
        locked_until: lock ? new Date(Date.now() + config.auth.lockMinutes * 60 * 1000) : null,
      });
    return { reason: lock ? 'locked-now' : 'password', userId: row.id };
  }
  if (row.status !== 'active') return { reason: 'deactivated', userId: row.id };

  await db('users').where({ id: row.id }).update({ failed_login_count: 0, locked_until: null });
  return { user: await findById(row.id) };
}

/** Re-check a signed-in user's password before sensitive changes. */
async function checkPassword(id, password) {
  const row = await db('users').select('password_hash').where({ id }).first();
  return Boolean(row) && bcrypt.compare(String(password || ''), row.password_hash);
}

async function recordLogin(id) {
  await db('users').where({ id }).update({ last_login_at: db.fn.now() });
}

/** Sets a new password and signs the user out of every other session. */
async function setPassword(id, password) {
  await db('users')
    .where({ id })
    .update({
      password_hash: await hashPassword(password),
      must_change_password: false,
      password_changed_at: db.fn.now(),
      failed_login_count: 0,
      locked_until: null,
      session_version: db.raw('session_version + 1'),
    });
  return findById(id);
}

/** Signs the user out everywhere. */
async function revokeSessions(id) {
  await db('users').where({ id }).update({ session_version: db.raw('session_version + 1') });
}

async function create({ name, email, phone, role }) {
  // Unusable random password until the person sets their own through the invite link.
  const placeholder = await hashPassword(require('crypto').randomBytes(32).toString('hex'));
  const [id] = await db('users').insert({
    name,
    email: normalizeEmail(email),
    phone: phone || null,
    role,
    password_hash: placeholder,
    must_change_password: true,
  });
  return findById(id);
}

async function update(id, changes) {
  const allowed = {};
  for (const key of ['name', 'email', 'phone', 'role']) {
    if (changes[key] !== undefined) allowed[key] = key === 'email' ? normalizeEmail(changes[key]) : changes[key] || null;
  }
  await db('users').where({ id }).update(allowed);
  return findById(id);
}

async function setStatus(id, status) {
  await db('users')
    .where({ id })
    .update({
      status,
      deactivated_at: status === 'deactivated' ? db.fn.now() : null,
      session_version: db.raw('session_version + 1'),
    });
  return findById(id);
}

async function remove(id) {
  await db('users').where({ id }).del();
}

function countActiveAdmins() {
  return db('users')
    .where({ role: ADMIN_ROLE, status: 'active' })
    .count({ n: '*' })
    .first()
    .then((r) => Number(r.n));
}

const emailTaken = (email, exceptId) =>
  db('users')
    .where({ email: normalizeEmail(email) })
    .modify((q) => exceptId && q.whereNot({ id: exceptId }))
    .first()
    .then(Boolean);

/** Paged, searchable list for the Accounts screen. */
async function list({ q = '', role = '', status = '', page = 1, perPage = 20 } = {}) {
  const query = db('users');
  const keyword = String(q).trim();
  if (keyword) {
    const like = `%${keyword.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    query.where((w) => w.where('name', 'like', like).orWhere('email', 'like', like));
  }
  if (role) query.where({ role });
  if (status) query.where({ status });
  const { total } = await query.clone().count({ total: '*' }).first();
  const pages = Math.max(1, Math.ceil(Number(total) / perPage));
  const current = Math.min(Math.max(1, Number.parseInt(page, 10) || 1), pages);
  const users = await query
    .select(PUBLIC_COLUMNS)
    .orderByRaw("status = 'active' DESC")
    .orderBy('name')
    .limit(perPage)
    .offset((current - 1) * perPage);
  return { users, total: Number(total), page: current, pages };
}

module.exports = {
  hashPassword,
  normalizeEmail,
  findById,
  findByEmail,
  findWithSecrets,
  authenticate,
  checkPassword,
  recordLogin,
  setPassword,
  revokeSessions,
  create,
  update,
  setStatus,
  remove,
  countActiveAdmins,
  emailTaken,
  list,
};
