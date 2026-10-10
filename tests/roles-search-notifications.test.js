import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db, formAgent } from './helpers.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const config = require('../src/config');
const roles = require('../src/services/roles');
const notifications = require('../src/services/notifications');
const { DEFAULT_ROLES } = require('../src/auth/permissions');

const app = createApp();
const PASSWORD = 'correct horse battery';
const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

const SCHEDULE_DEFAULTS = {
  admin: { mode: 'all' },
  program_director: { mode: 'roles', roles: ['program_coordinator', 'intake_specialist', 'reception'] },
  program_coordinator: { mode: 'roles', roles: ['intake_specialist', 'reception'] },
};

async function resetRoles() {
  await db('roles').whereNotIn('key', DEFAULT_ROLES.map((r) => r.key)).del();
  for (const r of DEFAULT_ROLES) {
    const row = await db('roles').where({ key: r.key }).first();
    await db('roles').where({ id: row.id }).update({ name: r.name, require_mfa: false, schedule_scope: JSON.stringify(SCHEDULE_DEFAULTS[r.key] || { mode: 'own' }) });
    await db('role_permissions').where({ role_id: row.id }).del();
    await db('role_permissions').insert(r.permissions.map((permission) => ({ role_id: row.id, permission })));
  }
  roles.clearCache();
}

async function makeUser(role, name) {
  const [id] = await db('users').insert({
    name: name || `${role} person`,
    email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role,
    password_hash: await bcrypt.hash(PASSWORD, 4),
  });
  return db('users').where({ id }).first();
}

async function signIn(user) {
  const agent = request.agent(app);
  const page = await agent.get('/portal/login');
  await agent.post('/portal/login').type('form').send({ email: user.email, password: PASSWORD, _csrf: csrfFrom(page.text) });
  return agent;
}

async function post(agent, fromPath, path, body = {}) {
  const page = await agent.get(fromPath);
  return agent.post(path).type('form').send({ ...body, _csrf: csrfFrom(page.text) });
}

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('password_tokens').del();
  await db('users').del();
  await resetRoles();
});

afterAll(async () => {
  await resetRoles();
  await db.destroy();
});

describe('roles & permissions', () => {
  it('lets the CEO/COO create a role with chosen permissions', async () => {
    const agent = await signIn(await makeUser('admin'));
    const res = await post(agent, '/portal/roles/new', '/portal/roles', {
      name: 'Program Lead',
      description: 'Leads a program',
      require_mfa: 'yes',
      permissions: ['jobs.edit', 'announcements.view', 'not.real'],
    });
    expect(res.status).toBe(303);
    const role = await roles.get('program_lead');
    // "Create & edit" brings "View" with it; unknown permissions are dropped.
    expect([...role.permissions].sort()).toEqual(['announcements.view', 'jobs.edit', 'jobs.view']);
    expect(role.require_mfa).toBe(true);
    expect(await db('audit_log').where({ action: 'role.create' }).first()).toBeTruthy();
  });

  it('applies permission changes to everyone with the role straight away', async () => {
    const coordinator = await makeUser('program_coordinator');
    const coordAgent = await signIn(coordinator);
    expect((await coordAgent.get('/portal/accounts')).status).toBe(403);

    const admin = await signIn(await makeUser('admin'));
    const role = await roles.get('program_coordinator');
    await post(admin, '/portal/roles/program_coordinator', '/portal/roles/program_coordinator', {
      name: role.name,
      description: role.description,
      permissions: [...role.permissions, 'accounts.view'],
    });
    expect((await coordAgent.get('/portal/accounts')).status).toBe(200);
    const entry = await db('audit_log').where({ action: 'role.update' }).first();
    expect(JSON.parse(entry.metadata).added).toEqual(['accounts.view']);
  });

  it('never lets the Admin role be edited or deleted', async () => {
    const agent = await signIn(await makeUser('admin'));
    await post(agent, '/portal/roles/admin', '/portal/roles/admin', { name: 'Admin', permissions: [] });
    expect((await roles.get('admin')).permissions.has('roles.edit')).toBe(true);
    await post(agent, '/portal/roles/admin', '/portal/roles/admin/delete');
    expect(await roles.get('admin')).toBeTruthy();
  });

  it('deletes a role only when nobody has it', async () => {
    const agent = await signIn(await makeUser('admin'));
    await post(agent, '/portal/roles/new', '/portal/roles', { name: 'Temp Role', permissions: ['jobs.view'] });
    const holder = await makeUser('temp_role');
    await post(agent, '/portal/roles/temp_role', '/portal/roles/temp_role/delete');
    expect(await roles.get('temp_role')).toBeTruthy();
    await db('users').where({ id: holder.id }).del();
    await post(agent, '/portal/roles/temp_role', '/portal/roles/temp_role/delete');
    expect(await roles.get('temp_role')).toBeNull();
  });

  it('stops people granting permissions they don’t have themselves', async () => {
    // A director who is allowed to manage roles…
    const role = await roles.get('program_director');
    await roles.update('program_director', { name: role.name, description: role.description, permissions: [...role.permissions, 'roles.view', 'roles.edit'] });
    const agent = await signIn(await makeUser('program_director'));
    // …can't create a role with access to staff accounts (which they don't have).
    const res = await post(agent, '/portal/roles/new', '/portal/roles', { name: 'Sneaky', permissions: ['accounts.delete'] });
    expect(res.status).toBe(422);
    expect(await roles.get('sneaky')).toBeNull();
    // …and can't edit their own role.
    await post(agent, '/portal/roles/program_director', '/portal/roles/program_director', { name: role.name, permissions: [...role.permissions, 'audit.view'] });
    expect((await roles.get('program_director')).permissions.has('audit.view')).toBe(false);
  });

  it('stops account managers giving out or managing roles above their own', async () => {
    const role = await roles.get('program_coordinator');
    // Also the General inquiry inbox, so Reception (below) has no access they lack.
    await roles.update('program_coordinator', { name: role.name, description: role.description, permissions: [...role.permissions, 'accounts.view', 'accounts.edit', 'accounts.archive', 'messages.inbox_general'] });
    const agent = await signIn(await makeUser('program_coordinator'));

    const promote = await post(agent, '/portal/accounts/new', '/portal/accounts', { name: 'New Admin', email: 'new.admin@example.com', role: 'admin' });
    expect(promote.status).toBe(422);
    expect(await db('users').where({ email: 'new.admin@example.com' }).first()).toBeUndefined();

    const admin = await makeUser('admin');
    const res = await post(agent, `/portal/accounts/${admin.id}`, `/portal/accounts/${admin.id}/deactivate`);
    expect(res.status).toBe(403);
    expect((await db('users').where({ id: admin.id }).first()).status).toBe('active');

    // They can manage someone with less access.
    const reception = await makeUser('reception');
    await post(agent, `/portal/accounts/${reception.id}`, `/portal/accounts/${reception.id}/deactivate`);
    expect((await db('users').where({ id: reception.id }).first()).status).toBe('deactivated');
  });

  it('checks each account action against its own permission', async () => {
    const role = await roles.get('program_coordinator');
    await roles.update('program_coordinator', { name: role.name, permissions: [...role.permissions, 'accounts.view', 'accounts.edit'] });
    const agent = await signIn(await makeUser('program_coordinator'));
    const target = await makeUser('reception');
    // Can edit, but "Deactivate" needs the archive permission.
    expect((await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/deactivate`)).status).toBe(403);
  });
});

describe('global search', () => {
  it('finds staff and pages for an admin', async () => {
    await makeUser('reception', 'Riley Reception');
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal/search?format=json&q=riley');
    const labels = res.body.groups.map((g) => g.label);
    expect(labels).toContain('Staff');
    expect(res.body.groups.find((g) => g.label === 'Staff').items[0].title).toBe('Riley Reception');
    const pages = await agent.get('/portal/search?format=json&q=audit');
    expect(pages.body.groups.find((g) => g.label === 'Pages').items[0].href).toBe('/portal/audit');
  });

  it('only returns what the role is allowed to see', async () => {
    await makeUser('admin', 'Avery Admin');
    const agent = await signIn(await makeUser('reception'));
    const res = await agent.get('/portal/search?format=json&q=avery');
    expect(res.body.groups.find((g) => g.label === 'Staff')).toBeUndefined();
    const pages = await agent.get('/portal/search?format=json&q=audit');
    expect(JSON.stringify(pages.body)).not.toContain('/portal/audit');
  });

  it('renders a results page and escapes the query', async () => {
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal/search?q=%3Cscript%3Ealert(1)%3C%2Fscript%3E');
    expect(res.status).toBe(200);
    expect(res.text).not.toContain('<script>alert(1)</script>');
  });
});

describe('notifications', () => {
  it('tells only staff who can see a new referral', async () => {
    await makeUser('admin'); // sees every message, but isn't alerted by default
    const intake = await makeUser('intake_specialist'); // referrals land in Intake
    await makeUser('reception'); // General inquiry only
    await makeUser('program_director'); // Program director only
    const deactivated = await makeUser('program_coordinator');
    await db('users').where({ id: deactivated.id }).update({ status: 'deactivated' });

    const { agent, csrf } = await formAgent(app, '/referrals');
    await agent.post('/referrals').type('form').send({
      referrer_name: 'Casey', referrer_email: 'casey@agency.example', referrer_phone: '410-555-0123', referrer_role: 'ccs',
      person_name: 'Jordan', county: 'Howard County', consent: 'yes', _csrf: csrf,
    });
    const notified = await db('notifications').where({ type: 'referral' }).pluck('user_id');
    expect(notified).toEqual([intake.id]);
  });

  it('shows the unread count and marks items read', async () => {
    const user = await makeUser('admin');
    await notifications.notifyUser(user.id, { type: 'security', title: 'Test alert', link: '/portal/account' });
    const agent = await signIn(user);
    const summary = await agent.get('/portal/notifications/summary').set('Accept', 'application/json');
    expect(summary.body.unread).toBe(1);
    const id = summary.body.items[0].id;

    const page = await agent.get('/portal/notifications');
    const read = await agent.post(`/portal/notifications/${id}/read`).type('form').send({ _csrf: csrfFrom(page.text) });
    expect(read.headers.location).toBe('/portal/account');
    expect((await agent.get('/portal/notifications/summary')).body.unread).toBe(0);
  });

  it('can’t read or mark someone else’s notifications', async () => {
    const owner = await makeUser('admin');
    await notifications.notifyUser(owner.id, { type: 'security', title: 'Private' });
    const [row] = await db('notifications').where({ user_id: owner.id });
    const agent = await signIn(await makeUser('reception'));
    expect((await agent.get('/portal/notifications/summary')).body.items).toEqual([]);
    const page = await agent.get('/portal/notifications');
    await agent.post(`/portal/notifications/${row.id}/read`).type('form').send({ _csrf: csrfFrom(page.text) });
    expect((await db('notifications').where({ id: row.id }).first()).read_at).toBeNull();
  });

  it('never follows an off-site link from a notification', async () => {
    const user = await makeUser('admin');
    await notifications.notifyUser(user.id, { type: 'x', title: 'Bad', link: '//evil.example' });
    const agent = await signIn(user);
    const [row] = await db('notifications').where({ user_id: user.id });
    const page = await agent.get('/portal/notifications');
    const res = await agent.post(`/portal/notifications/${row.id}/read`).type('form').send({ _csrf: csrfFrom(page.text) });
    expect(res.headers.location).toBe('/portal/notifications');
  });

  it('background refreshes don’t keep an idle session alive', async () => {
    const agent = await signIn(await makeUser('admin'));
    const original = config.session.idleMinutes;
    config.session.idleMinutes = 1 / 60 / 1000 * 20; // 20 ms
    await new Promise((r) => setTimeout(r, 10));
    await agent.get('/portal/notifications/summary'); // background: doesn't reset the idle clock
    await new Promise((r) => setTimeout(r, 15));
    const res = await agent.get('/portal');
    config.session.idleMinutes = original;
    expect(res.status).toBe(302);
  });
});

describe('portal layout', () => {
  it('has the header search, notifications, profile menu and footer', async () => {
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal');
    expect(res.text).toContain('data-global-search');
    expect(res.text).toContain('data-notif-button');
    expect(res.text).toContain('Account menu for');
    expect(res.text).toContain('Powered by');
    expect(res.text).toContain('src="/apple-touch-icon.png"');
  });
});

describe('IT Administrator', () => {
  it('can reset access for and deactivate staff with other roles', async () => {
    const director = await makeUser('program_director');
    const agent = await signIn(await makeUser('it_admin'));
    const reset = await post(agent, `/portal/accounts/${director.id}`, `/portal/accounts/${director.id}/send-reset`);
    expect(reset.status).toBe(303);
    expect(await db('password_tokens').where({ user_id: director.id, purpose: 'reset' }).first()).toBeTruthy();
    await post(agent, `/portal/accounts/${director.id}`, `/portal/accounts/${director.id}/deactivate`);
    expect((await db('users').where({ id: director.id }).first()).status).toBe('deactivated');
  });

  it('cannot touch Admin accounts', async () => {
    const admin = await makeUser('admin');
    const agent = await signIn(await makeUser('it_admin'));
    expect((await post(agent, `/portal/accounts/${admin.id}`, `/portal/accounts/${admin.id}/send-reset`)).status).toBe(403);
    expect((await post(agent, `/portal/accounts/${admin.id}`, `/portal/accounts/${admin.id}/deactivate`)).status).toBe(403);
  });

  it('cannot promote anyone or delete accounts permanently', async () => {
    const reception = await makeUser('reception');
    const agent = await signIn(await makeUser('it_admin'));
    const promote = await post(agent, `/portal/accounts/${reception.id}`, `/portal/accounts/${reception.id}`, {
      name: reception.name, email: reception.email, role: 'program_director',
    });
    expect(promote.status).toBe(422);
    expect((await db('users').where({ id: reception.id }).first()).role).toBe('reception');

    await post(agent, `/portal/accounts/${reception.id}`, `/portal/accounts/${reception.id}/deactivate`);
    expect((await post(agent, `/portal/accounts/${reception.id}`, `/portal/accounts/${reception.id}/delete`, { confirm: reception.email })).status).toBe(403);
  });

  it('can edit details of staff it manages without changing their role', async () => {
    const director = await makeUser('program_director');
    const agent = await signIn(await makeUser('it_admin'));
    const res = await post(agent, `/portal/accounts/${director.id}`, `/portal/accounts/${director.id}`, {
      name: 'Renamed Director', email: director.email, role: 'program_director',
    });
    expect(res.status).toBe(303);
    expect((await db('users').where({ id: director.id }).first()).name).toBe('Renamed Director');
  });

  it('sees accounts, roles and the audit log, but not client information', async () => {
    const agent = await signIn(await makeUser('it_admin'));
    for (const path of ['/portal/accounts', '/portal/roles', '/portal/audit']) expect((await agent.get(path)).status).toBe(200);
    expect((await agent.get('/portal/roles/new')).status).toBe(403);
    const dash = await agent.get('/portal');
    expect(dash.text).not.toContain('New referrals');
    expect(dash.text).not.toContain('Appointment requests');
  });
});
