import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const { generate } = require('otplib');
const config = require('../src/config');
const mfa = require('../src/services/mfa');
const tokens = require('../src/services/tokens');
const { sha256 } = require('../src/lib/crypto');
const roles = require('../src/services/roles');
const { DEFAULT_ROLES } = require('../src/auth/permissions');

/** Put roles back to the defaults; two-step off unless a test turns it on. */
async function resetRoles({ requireMfaFor = [] } = {}) {
  await db('roles').whereNotIn('key', DEFAULT_ROLES.map((r) => r.key)).del();
  for (const r of DEFAULT_ROLES) {
    const row = await db('roles').where({ key: r.key }).first();
    await db('roles').where({ id: row.id }).update({ name: r.name, require_mfa: requireMfaFor.includes(r.key) });
    await db('role_permissions').where({ role_id: row.id }).del();
    await db('role_permissions').insert(r.permissions.map((permission) => ({ role_id: row.id, permission })));
  }
  roles.clearCache();
}

const app = createApp();
const PASSWORD = 'correct horse battery';

async function makeUser(role, { email, status = 'active', mustChange = false } = {}) {
  const [id] = await db('users').insert({
    name: `${role} person`,
    email: email || `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role,
    status,
    must_change_password: mustChange,
    password_hash: await bcrypt.hash(PASSWORD, 4),
  });
  return db('users').where({ id }).first();
}

const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

/** Agent signed in as `user` (password only; MFA handled by caller). */
async function signIn(user, password = PASSWORD) {
  const agent = request.agent(app);
  const page = await agent.get('/portal/login');
  const res = await agent.post('/portal/login').type('form').send({ email: user.email, password, _csrf: csrfFrom(page.text) });
  return { agent, res };
}

/** POST a portal form, taking the CSRF token from a page first. */
async function post(agent, fromPath, path, body = {}) {
  const page = await agent.get(fromPath);
  return agent.post(path).type('form').send({ ...body, _csrf: csrfFrom(page.text) });
}

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('password_tokens').del();
  await db('mfa_recovery_codes').del();
  await db('users').del();
  await resetRoles();
});

afterAll(() => db.destroy());

const lastAudit = (action) => db('audit_log').where({ action }).orderBy('id', 'desc').first();

describe('sign in', () => {
  it('sends signed-out visitors to the sign-in page, remembering where they were going', async () => {
    const res = await request(app).get('/portal/accounts');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/portal/login?next=%2Fportal%2Faccounts');
  });

  it('signs in with the right password and gives a new session id', async () => {
    const user = await makeUser('reception');
    const agent = request.agent(app);
    const page = await agent.get('/portal/login');
    const before = page.headers['set-cookie'][0].split(';')[0];
    const res = await agent.post('/portal/login').type('form').send({ email: user.email.toUpperCase(), password: PASSWORD, _csrf: csrfFrom(page.text) });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal');
    const after = res.headers['set-cookie'][0].split(';')[0];
    expect(after).not.toBe(before); // session fixation protection
    expect((await agent.get('/portal')).text).toContain('reception person');
    expect(await lastAudit('auth.login')).toBeTruthy();
  });

  it('only redirects to portal pages after sign-in', async () => {
    const user = await makeUser('admin');
    const agent = request.agent(app);
    const page = await agent.get('/portal/login?next=//evil.example');
    const res = await agent.post('/portal/login').type('form').send({ email: user.email, password: PASSWORD, next: 'https://evil.example', _csrf: csrfFrom(page.text) });
    expect(res.headers.location).toBe('/portal');
  });

  it('gives the same message for a wrong password and an unknown email', async () => {
    const user = await makeUser('admin');
    const wrong = (await signIn(user, 'not the password')).res;
    const unknown = (await signIn({ email: 'nobody@example.com' })).res;
    expect(wrong.status).toBe(401);
    expect(unknown.status).toBe(401);
    const msg = (html) => html.match(/The email or password is incorrect[^<]*/)[0];
    expect(msg(wrong.text)).toBe(msg(unknown.text));
    expect(await lastAudit('auth.login_failed')).toBeTruthy();
  });

  it('locks the account after 5 wrong passwords, even for the right password', async () => {
    const user = await makeUser('admin');
    for (let i = 0; i < 5; i++) await signIn(user, 'wrong password!!');
    expect(await lastAudit('auth.locked')).toBeTruthy();
    const { res } = await signIn(user);
    expect(res.status).toBe(401);
    const row = await db('users').where({ id: user.id }).first();
    expect(new Date(row.locked_until) > new Date()).toBe(true);
  });

  it('refuses deactivated accounts', async () => {
    const user = await makeUser('admin', { status: 'deactivated' });
    expect((await signIn(user)).res.status).toBe(401);
  });

  it('signs out and ends the session', async () => {
    const user = await makeUser('reception');
    const { agent } = await signIn(user);
    const res = await post(agent, '/portal', '/portal/logout');
    expect(res.headers.location).toBe('/portal/login?ended=signed-out');
    expect((await agent.get('/portal')).status).toBe(302);
  });

  it('ends sessions after the maximum sign-in time', async () => {
    const user = await makeUser('reception');
    const { agent } = await signIn(user);
    // Shrink the limit rather than fake the clock (which would also trip the idle timeout).
    const original = config.session.maxHours;
    config.session.maxHours = 1 / 3600 / 1000; // 1 ms
    await new Promise((r) => setTimeout(r, 5));
    const res = await agent.get('/portal');
    config.session.maxHours = original;
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('ended=expired');
  });
});

describe('permissions', () => {
  it('lets only Admins open Accounts and the Audit log', async () => {
    for (const role of ['program_director', 'program_coordinator', 'intake_specialist', 'reception']) {
      const { agent } = await signIn(await makeUser(role));
      expect((await agent.get('/portal/accounts')).status).toBe(403);
      expect((await agent.get('/portal/audit')).status).toBe(403);
      const dash = await agent.get('/portal');
      expect(dash.text).not.toContain('href="/portal/accounts"');
    }
    const { agent } = await signIn(await makeUser('admin'));
    expect((await agent.get('/portal/accounts')).status).toBe(200);
    expect((await agent.get('/portal/audit')).status).toBe(200);
  });

  it('blocks non-admins from account actions even if they post directly', async () => {
    const target = await makeUser('reception');
    const { agent } = await signIn(await makeUser('program_director'));
    const res = await post(agent, '/portal', `/portal/accounts/${target.id}/deactivate`);
    expect(res.status).toBe(403);
    expect((await db('users').where({ id: target.id }).first()).status).toBe('active');
  });

  it('shows dashboard tiles only for what the role can see', async () => {
    const reception = await signIn(await makeUser('reception'));
    const dash = await reception.agent.get('/portal');
    expect(dash.text).toContain('Appointment requests');
    expect(dash.text).not.toContain('Open jobs');
    expect(dash.text).not.toContain('Active staff accounts');
  });

  it('requires CSRF tokens on portal forms', async () => {
    const { agent } = await signIn(await makeUser('admin'));
    const res = await agent.post('/portal/account/sign-out-others').type('form').send({});
    expect(res.status).toBe(303); // back to the page with "nothing was sent"
    expect(await db('audit_log').where({ action: 'profile.sign_out_others' }).first()).toBeUndefined();
    const json = await agent.post('/portal/account/sign-out-others').set('Accept', 'application/json').type('form').send({});
    expect(json.status).toBe(403);
  });
});

describe('accounts (admin)', () => {
  it('creates an account and emails an invitation that sets the password once', async () => {
    const { agent } = await signIn(await makeUser('admin'));
    const res = await post(agent, '/portal/accounts/new', '/portal/accounts', {
      name: 'New Coordinator', email: 'New.Coordinator@Example.com', phone: '', role: 'program_coordinator',
    });
    expect(res.status).toBe(303);
    const created = await db('users').where({ email: 'new.coordinator@example.com' }).first();
    expect(created).toMatchObject({ role: 'program_coordinator', must_change_password: 1 });
    expect(await lastAudit('account.create')).toBeTruthy();

    // The invitation link (we know the token by issuing a fresh one, as the email would contain).
    const token = await tokens.issue(created.id, 'invite');
    const visitor = request.agent(app);
    const form = await visitor.get(`/portal/invite/${token}`);
    expect(form.status).toBe(200);
    const set = await visitor.post(`/portal/invite/${token}`).type('form').send({ password: 'a brand new passphrase', confirm: 'a brand new passphrase', _csrf: csrfFrom(form.text) });
    expect(set.status).toBe(303);
    expect((await db('users').where({ id: created.id }).first()).must_change_password).toBe(0);

    // The link can't be used again.
    expect((await visitor.get(`/portal/invite/${token}`)).status).toBe(410);
    expect((await signIn({ email: created.email }, 'a brand new passphrase')).res.status).toBe(303);
  });

  it('rejects a duplicate email', async () => {
    const existing = await makeUser('reception');
    const { agent } = await signIn(await makeUser('admin'));
    const res = await post(agent, '/portal/accounts/new', '/portal/accounts', { name: 'Dup', email: existing.email, role: 'reception' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('already exists');
  });

  it('changes a role, records it, and signs the person out', async () => {
    const target = await makeUser('reception');
    const targetSession = (await signIn(target)).agent;
    const { agent } = await signIn(await makeUser('admin'));
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}`, {
      name: target.name, email: target.email, phone: '', role: 'program_coordinator',
    });
    expect((await db('users').where({ id: target.id }).first()).role).toBe('program_coordinator');
    expect((await lastAudit('account.role_change')).summary).toContain('from Reception to Program Coordinator');
    expect((await targetSession.get('/portal')).status).toBe(302);
  });

  it('deactivating signs the person out immediately; reactivating restores sign-in', async () => {
    const target = await makeUser('reception');
    const targetSession = (await signIn(target)).agent;
    const { agent } = await signIn(await makeUser('admin'));
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/deactivate`);
    expect((await targetSession.get('/portal')).status).toBe(302);
    expect((await signIn(target)).res.status).toBe(401);
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/reactivate`);
    expect((await signIn(target)).res.status).toBe(303);
  });

  it('protects admins from locking themselves or HLO out', async () => {
    const admin = await makeUser('admin');
    const { agent } = await signIn(admin);
    await post(agent, `/portal/accounts/${admin.id}`, `/portal/accounts/${admin.id}/deactivate`);
    expect((await db('users').where({ id: admin.id }).first()).status).toBe('active');

    const roleChange = await post(agent, `/portal/accounts/${admin.id}`, `/portal/accounts/${admin.id}`, {
      name: admin.name, email: admin.email, role: 'reception',
    });
    expect(roleChange.status).toBe(422);
    expect((await db('users').where({ id: admin.id }).first()).role).toBe('admin');
  });

  it('can demote another admin while at least one admin remains', async () => {
    const other = await makeUser('admin');
    const { agent } = await signIn(await makeUser('admin'));
    const res = await post(agent, `/portal/accounts/${other.id}`, `/portal/accounts/${other.id}`, {
      name: other.name, email: other.email, role: 'reception',
    });
    expect(res.status).toBe(303);
    expect((await db('users').where({ id: other.id }).first()).role).toBe('reception');
  });

  it('deletes permanently only a deactivated account, with the email typed to confirm', async () => {
    const target = await makeUser('reception');
    const { agent } = await signIn(await makeUser('admin'));
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/delete`, { confirm: target.email });
    expect(await db('users').where({ id: target.id }).first()).toBeTruthy(); // still active -> refused

    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/deactivate`);
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/delete`, { confirm: 'wrong@example.com' });
    expect(await db('users').where({ id: target.id }).first()).toBeTruthy();

    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/delete`, { confirm: target.email });
    expect(await db('users').where({ id: target.id }).first()).toBeUndefined();
    const entry = await lastAudit('account.delete');
    expect(entry.summary).toContain(target.email);
  });

  it('returns 404 for accounts that do not exist', async () => {
    const { agent } = await signIn(await makeUser('admin'));
    expect((await agent.get('/portal/accounts/999999')).status).toBe(404);
    expect((await agent.get('/portal/accounts/abc')).status).toBe(404);
  });
});

describe('forgot and reset password', () => {
  it('answers the same whether or not the email exists', async () => {
    const user = await makeUser('reception');
    const agent = request.agent(app);
    const send = async (email) => {
      const page = await agent.get('/portal/forgot-password');
      await agent.post('/portal/forgot-password').type('form').send({ email, _csrf: csrfFrom(page.text) });
      return (await agent.get('/portal/forgot-password')).text.includes('If that email belongs to an active staff account');
    };
    expect(await send(user.email)).toBe(true);
    expect(await send('nobody@example.com')).toBe(true);
    expect(await db('password_tokens').where({ user_id: user.id, purpose: 'reset' }).count({ n: '*' }).first()).toEqual({ n: 1 });
  });

  it('resets the password once, signs out other sessions, and rejects expired links', async () => {
    const user = await makeUser('reception');
    const oldSession = (await signIn(user)).agent;
    const token = await tokens.issue(user.id, 'reset');
    const visitor = request.agent(app);
    const form = await visitor.get(`/portal/reset-password/${token}`);
    const bad = await visitor.post(`/portal/reset-password/${token}`).type('form').send({ password: 'short', confirm: 'short', _csrf: csrfFrom(form.text) });
    expect(bad.status).toBe(422);
    const ok = await visitor.post(`/portal/reset-password/${token}`).type('form').send({ password: 'my new long passphrase', confirm: 'my new long passphrase', _csrf: csrfFrom(form.text) });
    expect(ok.status).toBe(303);
    expect((await oldSession.get('/portal')).status).toBe(302);
    expect((await signIn(user, 'my new long passphrase')).res.status).toBe(303);
    expect((await visitor.get(`/portal/reset-password/${token}`)).status).toBe(410);

    const expired = await tokens.issue(user.id, 'reset');
    await db('password_tokens').where({ token_hash: sha256(expired) }).update({ expires_at: new Date(Date.now() - 1000) });
    expect((await visitor.get(`/portal/reset-password/${expired}`)).status).toBe(410);
  });

  it('stores only a hash of reset tokens', async () => {
    const user = await makeUser('reception');
    const token = await tokens.issue(user.id, 'reset');
    const row = await db('password_tokens').where({ user_id: user.id }).first();
    expect(row.token_hash).toBe(sha256(token));
    expect(JSON.stringify(row)).not.toContain(token);
  });
});

describe('my account', () => {
  it('changes the password, keeps this session and signs out the others', async () => {
    const user = await makeUser('reception');
    const other = (await signIn(user)).agent;
    const { agent } = await signIn(user);
    const wrong = await post(agent, '/portal/account', '/portal/account/password', { current: 'nope', password: 'another long passphrase', confirm: 'another long passphrase' });
    expect(wrong.status).toBe(422);
    const res = await post(agent, '/portal/account', '/portal/account/password', { current: PASSWORD, password: 'another long passphrase', confirm: 'another long passphrase' });
    expect(res.status).toBe(303);
    expect((await agent.get('/portal')).status).toBe(200);
    expect((await other.get('/portal')).status).toBe(302);
  });

  it('updates name and phone but not role or email', async () => {
    const user = await makeUser('reception');
    const { agent } = await signIn(user);
    await post(agent, '/portal/account', '/portal/account/profile', { name: 'Renamed Person', phone: '410-555-0100', role: 'admin', email: 'x@example.com' });
    const row = await db('users').where({ id: user.id }).first();
    expect(row).toMatchObject({ name: 'Renamed Person', phone: '410-555-0100', role: 'reception', email: user.email });
  });
});

describe('two-step sign-in', () => {
  async function enable(agent, user) {
    const page = await agent.get('/portal/account/two-step');
    const secret = page.text.match(/select-all">([A-Z2-7 ]+)</)[1].replace(/\s/g, '');
    const code = await generate({ secret });
    const res = await agent.post('/portal/account/two-step/enable').type('form').send({ code, _csrf: csrfFrom(page.text) });
    const codes = [...res.text.matchAll(/>([A-Z2-9]{4}-[A-Z2-9]{4})</g)].map((m) => m[1]);
    return { secret, codes };
  }

  it('makes required roles set it up before using the portal', async () => {
    await resetRoles({ requireMfaFor: ['admin'] });
    const { agent } = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal/accounts');
    expect(res.status).toBe(302);
    expect(res.headers.location).toBe('/portal/account/two-step');
  });

  it('sets up, stores the secret encrypted, and shows 10 recovery codes once', async () => {
    const user = await makeUser('admin');
    const { agent } = await signIn(user);
    const { secret, codes } = await enable(agent, user);
    expect(codes).toHaveLength(10);
    const row = await db('users').where({ id: user.id }).first();
    expect(row.mfa_enabled).toBe(1);
    expect(row.mfa_secret).not.toContain(secret);
    expect(row.mfa_secret.startsWith('v1:')).toBe(true);
  });

  it('asks for a code after the password, and accepts each code only once', async () => {
    const user = await makeUser('admin');
    const { secret } = await enable((await signIn(user)).agent, user);

    const { agent, res } = await signIn(user);
    expect(res.headers.location).toBe('/portal/login/verify');
    expect((await agent.get('/portal')).status).toBe(302); // not signed in yet

    const page = await agent.get('/portal/login/verify');
    const wrong = await agent.post('/portal/login/verify').type('form').send({ code: '000000', _csrf: csrfFrom(page.text) });
    expect(wrong.status).toBe(401);

    // Use a fresh code (the set-up code was already used).
    const code = await generate({ secret, epoch: Math.floor(Date.now() / 1000) + 30 });
    const ok = await agent.post('/portal/login/verify').type('form').send({ code, _csrf: csrfFrom(page.text) });
    expect(ok.status).toBe(303);
    expect((await agent.get('/portal')).status).toBe(200);

    // The same code can't be replayed in another sign-in.
    const second = await signIn(user);
    const page2 = await second.agent.get('/portal/login/verify');
    const replay = await second.agent.post('/portal/login/verify').type('form').send({ code, _csrf: csrfFrom(page2.text) });
    expect(replay.status).toBe(401);
  });

  it('accepts a recovery code once', async () => {
    const user = await makeUser('admin');
    const { codes } = await enable((await signIn(user)).agent, user);
    for (const [i, expected] of [[0, 303], [1, 401]]) {
      const { agent } = await signIn(user);
      const page = await agent.get('/portal/login/verify');
      const res = await agent.post('/portal/login/verify').type('form').send({ code: codes[0].toLowerCase(), _csrf: csrfFrom(page.text) });
      expect(res.status, `attempt ${i + 1}`).toBe(expected);
    }
    expect(await mfa.remainingRecoveryCodes(user.id)).toBe(9);
  });

  it('lets an admin reset someone’s two-step sign-in', async () => {
    const target = await makeUser('reception');
    await enable((await signIn(target)).agent, target);
    const { agent } = await signIn(await makeUser('admin'));
    await post(agent, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/reset-two-step`);
    const row = await db('users').where({ id: target.id }).first();
    expect(row).toMatchObject({ mfa_enabled: 0, mfa_secret: null });
    expect(await lastAudit('account.reset_mfa')).toBeTruthy();
  });
});

describe('audit log viewer', () => {
  it('lists and filters entries', async () => {
    const admin = await makeUser('admin');
    const { agent } = await signIn(admin);
    await signIn(admin, 'wrong password here');
    const all = await agent.get('/portal/audit');
    expect(all.text).toContain('Failed sign-in for');
    const filtered = await agent.get('/portal/audit?action=auth.login');
    expect(filtered.text).not.toContain('Failed sign-in for');
    expect(filtered.text).toContain('signed in');
  });
});
