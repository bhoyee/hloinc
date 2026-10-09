import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post, csrfFrom, PASSWORD } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const security = require('../src/services/security');
const roles = require('../src/services/roles');
const { encrypt } = require('../src/lib/crypto');
const { generateSecret } = require('otplib');

const app = createApp();

/** A user who has linked an authenticator app. */
async function withApp(role) {
  const user = await makeUser(role);
  await db('users').where({ id: user.id }).update({ mfa_enabled: true, mfa_secret: encrypt(generateSecret()) });
  return user;
}

async function passwordStep(user) {
  const agent = request.agent(app);
  const page = await agent.get('/portal/login');
  const res = await agent.post('/portal/login').type('form').send({ email: user.email, password: PASSWORD, _csrf: csrfFrom(page.text) });
  return { agent, res };
}

const setSwitch = (agent, value, password = PASSWORD) => post(agent, '/portal/settings/security', '/portal/settings/security', { two_step: value, password });

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('site_settings').where({ key: 'security.two_step' }).del();
  await db('users').del();
  await resetRoles();
  security.clearCache();
});

afterAll(async () => {
  await db('site_settings').where({ key: 'security.two_step' }).del();
  await db.destroy();
});

describe('security settings: access', () => {
  it('is for the CEO/COO (Admin), not other roles', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const page = await admin.get('/portal/settings/security');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Currently on');
    expect((await admin.get('/portal')).text).toContain('href="/portal/settings/security"');

    for (const role of ['it_admin', 'program_director', 'reception']) {
      const agent = await signIn(app, await makeUser(role));
      expect((await agent.get('/portal/settings/security')).status).toBe(403);
    }
  });

  it('needs the password, and records who changed it', async () => {
    const admin = await signIn(app, await makeUser('admin', 'Avery Admin'));
    const other = await makeUser('admin', 'Other Admin');
    const wrong = await setSwitch(admin, 'off', 'not my password');
    expect(wrong.status).toBe(422);
    expect(await security.twoStepOn()).toBe(true);

    expect((await setSwitch(admin, 'off')).status).toBe(303);
    security.clearCache();
    expect(await security.twoStepOn()).toBe(false);
    expect(await db('audit_log').where({ action: 'security.two_step_off' }).first()).toMatchObject({ user_name: 'Avery Admin' });
    // The other admin is told; the person who changed it isn't notified about their own change.
    expect(await db('notifications').where({ user_id: other.id }).first()).toMatchObject({ title: 'Two-step sign-in switched off for everyone' });
    expect(await db('notifications').whereNot({ user_id: other.id }).first()).toBeUndefined();
  });
});

describe('security settings: two-step switched off', () => {
  it('lets people with a linked app sign in with just their password', async () => {
    const user = await withApp('program_coordinator');
    expect((await passwordStep(user)).res.headers.location).toBe('/portal/login/verify'); // on: code needed

    await security.setTwoStep(false, user);
    const { res, agent } = await passwordStep(user);
    expect(res.headers.location).toBe('/portal');
    expect((await agent.get('/portal')).status).toBe(200);
    // Their app stays linked for when it's switched back on.
    expect((await db('users').where({ id: user.id }).first()).mfa_enabled).toBeTruthy();
  });

  it('stops forcing set-up for roles that require it, and resumes when switched on', async () => {
    const director = await roles.get('program_director');
    await db('roles').where({ key: 'program_director' }).update({ require_mfa: true });
    roles.clearCache();
    const user = await makeUser('program_director');

    const agent = await signIn(app, user);
    expect((await agent.get('/portal')).headers.location).toBe('/portal/account/two-step');

    await security.setTwoStep(false, user);
    expect((await agent.get('/portal')).status).toBe(200);
    const twoStep = await agent.get('/portal/account/two-step');
    expect(twoStep.text).toContain('switched off for everyone');
    expect(twoStep.text).not.toContain('Turn on two-step sign-in');

    await security.setTwoStep(true, user);
    expect((await agent.get('/portal')).headers.location).toBe('/portal/account/two-step');
    expect(director).toBeTruthy();
  });
});
