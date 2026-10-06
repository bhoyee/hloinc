'use strict';

const db = require('../db/knex');
const { ADMIN_ROLE, ALL_PERMISSIONS, normalize } = require('../auth/permissions');

/*
 * Roles are read on every portal request, so they're cached in memory.
 * Changes made here clear the cache at once; other server processes pick
 * them up within CACHE_MS.
 */
const CACHE_MS = 30 * 1000;
let cache = { at: 0, roles: null };

async function loadAll() {
  if (cache.roles && Date.now() - cache.at < CACHE_MS) return cache.roles;
  const rows = await db('roles').select('*').orderByRaw('is_system DESC').orderBy('name');
  const perms = await db('role_permissions').select('role_id', 'permission');
  const roles = new Map();
  for (const r of rows) {
    const granted = r.key === ADMIN_ROLE ? ALL_PERMISSIONS : perms.filter((p) => p.role_id === r.id).map((p) => p.permission);
    roles.set(r.key, {
      ...r,
      is_system: Boolean(r.is_system),
      require_mfa: Boolean(r.require_mfa),
      permissions: new Set(normalize(granted)),
    });
  }
  cache = { at: Date.now(), roles };
  return roles;
}

const clearCache = () => {
  cache = { at: 0, roles: null };
};

/** All roles, each with a Set of permissions. */
async function list() {
  return [...(await loadAll()).values()];
}

async function get(key) {
  return (await loadAll()).get(key) || null;
}

/** Role key -> display name, for labels. */
async function labels() {
  return Object.fromEntries((await list()).map((r) => [r.key, r.name]));
}

async function userCounts() {
  const rows = await db('users').select('role').count({ n: '*' }).groupBy('role');
  return Object.fromEntries(rows.map((r) => [r.role, Number(r.n)]));
}

/** "Program Lead" -> "program_lead", unique among existing roles. */
async function uniqueKey(name) {
  const base = String(name).toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_|_$/g, '').slice(0, 30) || 'role';
  let key = base;
  for (let i = 2; await db('roles').where({ key }).first(); i++) key = `${base}_${i}`;
  return key;
}

async function create({ name, description, requireMfa, permissions }) {
  const key = await uniqueKey(name);
  await db.transaction(async (trx) => {
    const [id] = await trx('roles').insert({ key, name, description: description || null, require_mfa: Boolean(requireMfa) });
    const rows = normalize(permissions).map((permission) => ({ role_id: id, permission }));
    if (rows.length) await trx('role_permissions').insert(rows);
  });
  clearCache();
  return get(key);
}

async function update(key, { name, description, requireMfa, permissions }) {
  const role = await db('roles').where({ key }).first();
  if (!role || role.is_system) throw new Error('This role can’t be changed.');
  await db.transaction(async (trx) => {
    await trx('roles').where({ id: role.id }).update({ name, description: description || null, require_mfa: Boolean(requireMfa) });
    await trx('role_permissions').where({ role_id: role.id }).del();
    const rows = normalize(permissions).map((permission) => ({ role_id: role.id, permission }));
    if (rows.length) await trx('role_permissions').insert(rows);
  });
  clearCache();
  return get(key);
}

async function remove(key) {
  const role = await db('roles').where({ key }).first();
  if (!role || role.is_system) throw new Error('This role can’t be deleted.');
  await db('roles').where({ id: role.id }).del();
  clearCache();
}

module.exports = { list, get, labels, userCounts, create, update, remove, clearCache };
