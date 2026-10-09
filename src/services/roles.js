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

/**
 * Whose schedules a role can see: { mode: 'all' | 'own' | 'roles', roles: [keys] }.
 * Admin always sees everyone; unknown or missing values mean "only their own".
 */
function parseScope(raw, key) {
  if (key === ADMIN_ROLE) return { mode: 'all', roles: [] };
  try {
    const v = typeof raw === 'string' ? JSON.parse(raw) : raw;
    if (v && v.mode === 'all') return { mode: 'all', roles: [] };
    if (v && v.mode === 'roles' && Array.isArray(v.roles) && v.roles.length) return { mode: 'roles', roles: v.roles.filter((r) => typeof r === 'string') };
  } catch {
    // fall through
  }
  return { mode: 'own', roles: [] };
}

const scopeJson = (scope) => JSON.stringify(scope && scope.mode === 'roles' ? { mode: 'roles', roles: scope.roles } : { mode: scope && scope.mode === 'all' ? 'all' : 'own' });

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
      scheduleScope: parseScope(r.schedule_scope, r.key),
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

async function create({ name, description, requireMfa, scheduleScope, permissions }) {
  const key = await uniqueKey(name);
  await db.transaction(async (trx) => {
    const [id] = await trx('roles').insert({ key, name, description: description || null, require_mfa: Boolean(requireMfa), schedule_scope: scopeJson(scheduleScope) });
    const rows = normalize(permissions).map((permission) => ({ role_id: id, permission }));
    if (rows.length) await trx('role_permissions').insert(rows);
  });
  clearCache();
  return get(key);
}

async function update(key, { name, description, requireMfa, scheduleScope, permissions }) {
  const role = await db('roles').where({ key }).first();
  if (!role || role.is_system) throw new Error('This role can’t be changed.');
  await db.transaction(async (trx) => {
    await trx('roles').where({ id: role.id }).update({ name, description: description || null, require_mfa: Boolean(requireMfa), schedule_scope: scopeJson(scheduleScope) });
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

module.exports = { list, get, labels, userCounts, create, update, remove, clearCache, parseScope };
