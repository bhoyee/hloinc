import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post, csrfFrom } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const sharp = require('sharp');
const fs = require('fs');
const { _outbox: outbox } = require('../src/services/notify');
const support = require('../src/services/support');

const app = createApp();

async function send(agent, fields, file) {
  const page = await agent.get('/portal/help/new');
  let req = agent.post('/portal/help').field('_csrf', csrfFrom(page.text));
  for (const [k, v] of Object.entries(fields)) req = req.field(k, v);
  if (file) req = req.attach('screenshot', file.buffer, { filename: file.name, contentType: file.type });
  return req;
}

const ask = { category: 'broken', message: 'The Log walk-in button does nothing when I click it.', from: '/portal/appointments', screen: '1440×900' };

beforeEach(async () => {
  await db('support_requests').del();
  await db('notifications').del();
  await db('audit_log').del();
  await db('site_settings').whereIn('key', ['support.forward_email', 'alerts.routing']).del();
  await db('users').del();
  await resetRoles();
  require('../src/services/content').clearCache();
  outbox.length = 0;
});

afterAll(async () => {
  await db('support_requests').del();
  await db.destroy();
});

describe('Get help', () => {
  it('is in everyone’s menu, and remembers the page it was opened from', async () => {
    const agent = await signIn(app, await makeUser('reception'));
    const page = await agent.get('/portal/schedule');
    expect(page.text).toContain('/portal/help/new?from=%2Fportal%2Fschedule');
    expect(page.text).not.toContain('Help requests</'); // the team list is not in their menu
    const form = await agent.get('/portal/help/new?from=%2Fportal%2Fschedule&category=access');
    expect(form.status).toBe(200);
    expect(form.text).toContain('name="from" value="/portal/schedule"');
    expect(form.text).toMatch(/value="access"\s+class="sr-only"\s+checked/);
  });

  it('records the request with page, browser and screen, and tells IT and Admin by bell and email', async () => {
    const it = await makeUser('it_admin', 'Ian IT');
    const admin = await makeUser('admin', 'Avery Admin');
    const sender = await makeUser('reception', 'Riley Reception');
    const agent = await signIn(app, sender);
    const res = await send(agent.set('User-Agent', 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/141.0 Safari/537.36'), ask);
    expect(res.status).toBe(303);
    const r = await db('support_requests').first();
    expect(r.reference).toMatch(/^HLO-HLP-[2-9A-HJKMNP-Z]{6}$/);
    expect(r).toMatchObject({ user_id: sender.id, category: 'broken', status: 'open', page_url: '/portal/appointments', browser: 'Chrome 141 on Windows', screen: '1440×900' });
    expect(res.headers.location).toBe(`/portal/help/${r.id}`);

    const told = await db('notifications').where({ type: 'support' }).pluck('user_id');
    expect(told.sort()).toEqual([it.id, admin.id].sort());
    const mail = outbox.find((m) => m.to === it.email);
    expect(mail.subject).toContain(r.reference);
    expect(mail.replyTo).toBe(sender.email);
    expect(mail.text).toContain('Page: ');
    expect(mail.text).toContain('/portal/appointments');
    expect(mail.text).toContain('Log walk-in button does nothing');
  });

  it('forwards "Something isn’t working" to the developer email when set, and nothing else', async () => {
    const admin = await makeUser('admin');
    const adminAgent = await signIn(app, admin);
    const saved = await post(adminAgent, '/portal/help', '/portal/help/settings', { forward_email: 'Dev@Example.com' });
    expect(saved.status).toBe(303);
    expect(await support.forwardEmail()).toBe('dev@example.com');

    const agent = await signIn(app, await makeUser('reception'));
    await send(agent, { ...ask, error_ref: 'ERR-ABC234' });
    await send(agent, { ...ask, category: 'howto', message: 'How do I change my profile photo please?' });
    const toDev = outbox.filter((m) => m.to === 'dev@example.com');
    expect(toDev).toHaveLength(1);
    expect(toDev[0].text).toContain('Error reference: ERR-ABC234');
    expect(toDev[0].text).not.toContain('profile photo');
    expect((await db('support_requests').where({ category: 'broken' }).first()).forwarded_at).not.toBeNull();
  });

  it('keeps a screenshot, re-encoded, for the sender and the team only', async () => {
    await makeUser('it_admin');
    const sender = await makeUser('reception');
    const agent = await signIn(app, sender);
    const png = await sharp({ create: { width: 40, height: 30, channels: 3, background: '#cc0000' } }).png().toBuffer();
    await send(agent, ask, { buffer: png, name: 'screen.png', type: 'image/png' });
    const r = await db('support_requests').first();
    expect(r.screenshot).toMatch(/^[a-f0-9]{32}\.webp$/);
    expect(fs.existsSync(support.screenshotFile(r.screenshot))).toBe(true);

    const mine = await agent.get(`/portal/help/${r.id}/screenshot`);
    expect(mine.status).toBe(200);
    expect(mine.headers['content-type']).toBe('image/webp');
    const it = await signIn(app, await makeUser('it_admin'));
    expect((await it.get(`/portal/help/${r.id}/screenshot`)).status).toBe(200);
    const other = await signIn(app, await makeUser('program_coordinator'));
    expect((await other.get(`/portal/help/${r.id}`)).status).toBe(404);
    expect((await other.get(`/portal/help/${r.id}/screenshot`)).status).toBe(404);
    fs.rmSync(support.screenshotFile(r.screenshot), { force: true });
  });

  it('refuses a file that isn’t an image', async () => {
    const agent = await signIn(app, await makeUser('reception'));
    const res = await send(agent, ask, { buffer: Buffer.from('not really'), name: 'x.png', type: 'image/png' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('isn’t an image we can read');
    expect(await db('support_requests').count({ n: '*' }).first()).toEqual({ n: 0 });
  });

  it('checks what was typed', async () => {
    const agent = await signIn(app, await makeUser('reception'));
    const res = await send(agent, { category: 'nonsense', message: 'short' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Choose what it’s about.');
    expect(res.text).toContain('at least 10 characters');
  });

  it('lets IT reply and mark it fixed; the sender is told and can open it again', async () => {
    const itUser = await makeUser('it_admin', 'Ian IT');
    const sender = await makeUser('reception', 'Riley Reception');
    const agent = await signIn(app, sender);
    await send(agent, ask);
    const r = await db('support_requests').first();
    outbox.length = 0;

    const it = await signIn(app, itUser);
    const list = await it.get('/portal/help');
    expect(list.text).toContain('Riley Reception');
    expect(list.text).toContain('data-nav-badge="support"');
    const done = await post(it, `/portal/help/${r.id}`, `/portal/help/${r.id}/reply`, { body: 'Fixed now, please try again.', status: 'fixed' });
    expect(done.status).toBe(303);
    expect(await db('support_requests').where({ id: r.id }).first()).toMatchObject({ status: 'fixed', handled_by: itUser.id });
    expect(await db('notifications').where({ user_id: sender.id, type: 'support' }).first('title')).toEqual({ title: `Your help request is fixed (${r.reference})` });
    expect(outbox.find((m) => m.to === sender.email).text).toContain('Fixed now, please try again.');

    // The sender can't change the status themselves, but replying to a fixed request opens it again.
    await post(agent, `/portal/help/${r.id}`, `/portal/help/${r.id}/reply`, { body: 'Still happening on my computer.', status: 'fixed' });
    expect((await db('support_requests').where({ id: r.id }).first()).status).toBe('open');
    expect(await db('notifications').where({ user_id: itUser.id }).orderBy('id', 'desc').first('title')).toEqual({ title: 'Help request opened again by Riley Reception' });
    const page = await agent.get(`/portal/help/${r.id}`);
    expect(page.text).toContain('Still happening on my computer.');
    expect(page.text).toContain('Fixed now, please try again.');
  });

  it('shows staff only their own requests, and keeps the team list and settings to those allowed', async () => {
    await makeUser('it_admin');
    const a = await signIn(app, await makeUser('reception', 'Riley Reception'));
    await send(a, ask);
    const b = await signIn(app, await makeUser('program_coordinator', 'Casey Coordinator'));
    const list = await b.get('/portal/help?tab=all');
    expect(list.text).toContain('You haven’t asked for help yet');
    expect(list.text).not.toContain('Riley Reception');
    expect((await post(b, '/portal/help', '/portal/help/settings', { forward_email: 'x@example.com' })).status).toBe(403);
    const it = await signIn(app, await makeUser('it_admin'));
    const itList = await it.get('/portal/help');
    expect(itList.text).not.toContain('forward problem reports'); // IT deals with requests; Admin sets the forwarding address
  });

  it('limits how many requests one person can send in an hour', async () => {
    const sender = await makeUser('reception');
    await db('support_requests').insert(Array.from({ length: 10 }, (_, i) => ({ reference: `HLO-HLP-AAAAA${'23456789AB'[i]}`, user_id: sender.id, user_name: 'x', category: 'howto', message: 'earlier request' })));
    const agent = await signIn(app, sender);
    const res = await send(agent, ask);
    expect(res.status).toBe(422);
    expect(res.text).toContain('a lot of requests in the last hour');
  });

  it('gives server errors a reference and a "Report this problem" link', async () => {
    const { errorHandler } = require('../src/middleware/errors');
    let rendered;
    const res = { headersSent: false, status() { return this; }, render(view, locals) { rendered = { view, locals }; } };
    const req = { user: { id: 1 }, originalUrl: '/portal/leads?x=1', method: 'GET', accepts: () => 'html' };
    const spy = console.error;
    console.error = () => {};
    errorHandler(new Error('boom'), req, res, () => {});
    console.error = spy;
    expect(rendered.view).toBe('pages/portal/error.njk');
    expect(rendered.locals.errorRef).toMatch(/^ERR-[2-9A-HJKMNP-Z]{6}$/);
    expect(rendered.locals.from).toBe('/portal/leads?x=1');
  });
});
