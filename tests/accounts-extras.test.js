import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post, PASSWORD } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const config = require('../src/config');
const { initials, color, COLORS } = require('../src/lib/avatar');

const app = createApp();
const AVATARS = path.join(config.paths.storage, 'avatars');

beforeEach(async () => {
  await db('audit_log').del();
  await db('users').del();
  await resetRoles();
});

afterAll(() => db.destroy());

describe('suspending an account', () => {
  it('signs the person out, blocks sign-in, records who and why, and can be lifted', async () => {
    const admin = await signIn(app, await makeUser('admin', 'Avery Admin'));
    const target = await makeUser('reception', 'Riley Reception');
    const theirs = await signIn(app, target);
    expect((await theirs.get('/portal')).status).toBe(200);

    await post(admin, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/suspend`, { reason: 'Under review' });
    expect(await db('users').where({ id: target.id }).first()).toMatchObject({ status: 'suspended', suspended_reason: 'Under review', suspended_by_name: 'Avery Admin' });
    expect((await theirs.get('/portal')).status).toBe(302); // signed out
    const page = (await admin.get(`/portal/accounts/${target.id}`)).text;
    expect(page).toContain('This account is suspended');
    expect(page).toContain('Under review');
    expect((await admin.get('/portal/accounts?status=suspended')).text).toContain('Riley Reception');

    await post(admin, `/portal/accounts/${target.id}`, `/portal/accounts/${target.id}/unsuspend`);
    expect(await db('users').where({ id: target.id }).first()).toMatchObject({ status: 'active', suspended_reason: null });
    expect(await db('audit_log').whereIn('action', ['account.suspend', 'account.unsuspend']).pluck('action')).toHaveLength(2);
  });

  it('won’t suspend yourself or the last Admin, and needs the deactivate permission', async () => {
    const adminUser = await makeUser('admin');
    const admin = await signIn(app, adminUser);
    await post(admin, `/portal/accounts/${adminUser.id}`, `/portal/accounts/${adminUser.id}/suspend`);
    expect((await db('users').where({ id: adminUser.id }).first()).status).toBe('active');

    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const reception = await makeUser('reception');
    expect((await post(coordinator, `/portal/accounts/${reception.id}`, `/portal/accounts/${reception.id}/suspend`)).status).toBe(403);
  });
});

describe('profile photos', () => {
  it('shows initials without a photo', () => {
    expect(initials('Avery Admin')).toBe('AA');
    expect(initials('Mary Jane Watson')).toBe('MW');
    expect(initials('Prince')).toBe('P');
    expect(COLORS).toContain(color('Avery Admin'));
    expect(color('Avery Admin')).toBe(color('Avery Admin'));
  });

  it('lets people upload, see and remove their own photo; only staff can load it', async () => {
    const me = await makeUser('reception', 'Riley Reception');
    const agent = await signIn(app, me);
    expect((await agent.get('/portal/accounts')).status).toBe(403); // (no access to the list; fine)
    const page = await agent.get('/portal/account');
    expect(page.text).toContain('Profile photo');
    expect(page.text).toMatch(/>RR</);

    const csrf = page.text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    const png = await sharp({ create: { width: 600, height: 400, channels: 3, background: '#12845a' } }).png().toBuffer();
    const res = await agent.post('/portal/account/avatar').field('_csrf', csrf).attach('photo', png, 'me.png');
    expect(res.status).toBe(303);
    const { avatar } = await db('users').where({ id: me.id }).first();
    expect(avatar).toMatch(/^[a-f0-9]{32}\.webp$/);
    const meta = await sharp(fs.readFileSync(path.join(AVATARS, avatar))).metadata();
    expect(meta).toMatchObject({ width: 256, height: 256, format: 'webp' });

    const img = await agent.get(`/portal/avatars/${me.id}`);
    expect(img.status).toBe(200);
    expect(img.headers['content-type']).toBe('image/webp');
    expect((await (await import('supertest')).default(app).get(`/portal/avatars/${me.id}`)).status).toBe(302); // not signed in

    await post(agent, '/portal/account', '/portal/account/avatar/remove');
    expect((await db('users').where({ id: me.id }).first()).avatar).toBeNull();
    expect(fs.existsSync(path.join(AVATARS, avatar))).toBe(false);
  });

  it('refuses files that aren’t photos', async () => {
    const me = await makeUser('reception');
    const agent = await signIn(app, me);
    const csrf = (await agent.get('/portal/account')).text.match(/name="_csrf" value="([a-f0-9]+)"/)[1];
    await agent.post('/portal/account/avatar').field('_csrf', csrf).attach('photo', Buffer.from('not an image'), { filename: 'x.png', contentType: 'image/png' });
    expect((await db('users').where({ id: me.id }).first()).avatar).toBeNull();
  });
});

void PASSWORD;
