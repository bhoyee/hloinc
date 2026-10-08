import request from 'supertest';
import { createRequire } from 'module';
import { db } from './helpers.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const roles = require('../src/services/roles');
const { DEFAULT_ROLES, normalize } = require('../src/auth/permissions');

export const PASSWORD = 'correct horse battery';
export const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

/** Put the starting roles back exactly as defined, without two-step sign-in (simpler tests). */
export async function resetRoles() {
  await db('roles').whereNotIn('key', DEFAULT_ROLES.map((r) => r.key)).del();
  for (const r of DEFAULT_ROLES) {
    const row = await db('roles').where({ key: r.key }).first();
    await db('roles').where({ id: row.id }).update({ require_mfa: false });
    await db('role_permissions').where({ role_id: row.id }).del();
    await db('role_permissions').insert(normalize(r.permissions).map((permission) => ({ role_id: row.id, permission })));
  }
  roles.clearCache();
}

/** A custom role with exactly these permissions. */
export async function makeRole(key, permissions) {
  const [id] = await db('roles').insert({ key, name: key, description: '' });
  if (permissions.length) await db('role_permissions').insert(normalize(permissions).map((permission) => ({ role_id: id, permission })));
  roles.clearCache();
  return id;
}

export async function makeUser(role, name) {
  const [id] = await db('users').insert({
    name: name || `${role} person`,
    email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role,
    password_hash: await bcrypt.hash(PASSWORD, 4),
  });
  return db('users').where({ id }).first();
}

export async function signIn(app, user) {
  const agent = request.agent(app);
  const page = await agent.get('/portal/login');
  await agent.post('/portal/login').type('form').send({ email: user.email, password: PASSWORD, _csrf: csrfFrom(page.text) });
  return agent;
}

/** POST a form with a CSRF token taken from `fromPath`. */
export async function post(agent, fromPath, path, body = {}) {
  const page = await agent.get(fromPath);
  return agent.post(path).type('form').send({ ...body, _csrf: csrfFrom(page.text) });
}
