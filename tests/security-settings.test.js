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

describe('Turnstile spam protection (Security settings)', () => {
  const turnstile = require('../src/lib/turnstile');
  const realFetch = globalThis.fetch;
  // Cloudflare's answers: a wrong secret is reported as "invalid-input-secret".
  const cloudflare = (answer) => {
    globalThis.fetch = async (url, opts) => {
      if (!String(url).includes('challenges.cloudflare.com')) return realFetch(url, opts);
      return { json: async () => answer(String(opts.body)) };
    };
  };
  const save = (agent, { password = PASSWORD, ...body }) => post(agent, '/portal/settings/security', '/portal/settings/turnstile', { turnstile_password: password, ...body });

  beforeEach(async () => {
    await db('site_settings').where({ key: 'security.turnstile' }).del();
    turnstile.clearCache();
  });
  afterAll(async () => {
    globalThis.fetch = realFetch;
    await db('site_settings').where({ key: 'security.turnstile' }).del();
    turnstile.clearCache();
  });

  it('is switched on with keys by the Admin, checks the secret, and protects the forms', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    expect((await admin.get('/portal/settings/security')).text).toContain('Spam protection on the website forms');

    // Needs the keys, and the password.
    expect((await save(admin, { turnstile: 'on' })).status).toBe(422);
    expect((await save(admin, { turnstile: 'on', site_key: '0x4AAAAAAAtestsitekey', secret_key: '0x4AAAAAAAtestsecretkey', password: 'wrong' })).status).toBe(422);
    // A secret Cloudflare doesn't know is refused.
    cloudflare(() => ({ success: false, 'error-codes': ['invalid-input-secret'] }));
    const bad = await save(admin, { turnstile: 'on', site_key: '0x4AAAAAAAtestsitekey', secret_key: '0x4AAAAAAAwrongsecret' });
    expect(bad.status).toBe(422);
    expect(bad.text).toContain('didn’t accept that secret key');

    cloudflare(() => ({ success: false, 'error-codes': ['invalid-input-response'] }));
    expect((await save(admin, { turnstile: 'on', site_key: '0x4AAAAAAAtestsitekey', secret_key: '0x4AAAAAAAtestsecretkey' })).status).toBe(303);
    const row = await db('site_settings').where({ key: 'security.turnstile' }).first();
    expect(JSON.stringify(row.value)).not.toContain('testsecretkey'); // stored encrypted
    const log = await db('audit_log').where({ action: 'security.turnstile_on' }).first();
    expect(log.summary).not.toContain('testsecretkey');

    // The website forms now show the check, and the security headers allow Cloudflare.
    const contact = await request(app).get('/contact');
    expect(contact.text).toContain('data-sitekey="0x4AAAAAAAtestsitekey"');
    expect(contact.headers['content-security-policy']).toContain('https://challenges.cloudflare.com');
    // The settings page never shows the secret again.
    expect((await admin.get('/portal/settings/security')).text).not.toContain('testsecretkey');

    // A blank secret keeps the saved one; switching off removes the check from the forms.
    expect((await save(admin, { turnstile: 'off', site_key: '0x4AAAAAAAtestsitekey' })).status).toBe(303);
    turnstile.clearCache();
    expect((await turnstile.settings()).secretKey).toBe('0x4AAAAAAAtestsecretkey');
    const off = await request(app).get('/contact');
    expect(off.text).not.toContain('cf-turnstile');
    expect(off.headers['content-security-policy']).not.toContain('challenges.cloudflare.com');
  });

  it('is for the Admin only', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    expect((await director.get('/portal/settings/security')).status).toBe(403);
  });
});
