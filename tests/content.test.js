import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import fs from 'fs';
import path from 'path';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post, csrfFrom } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const content = require('../src/services/content');
const cms = require('../src/services/cms');
const pages = require('../src/content/pages');
const config = require('../src/config');
const { defaults } = require('../src/lib/site');

const app = createApp();

/** A signed-in agent plus the CSRF token for JSON calls. */
async function editor(role) {
  const agent = await signIn(app, await makeUser(role));
  const page = await agent.get('/portal/content/pages/careers');
  return { agent, token: (page.text.match(/name="csrf-token" content="([a-f0-9]+)"/) || [])[1] || csrfFrom(page.text) };
}
const json = (e, path, body) => e.agent.post(path).set('Accept', 'application/json').set('x-csrf-token', e.token).send(body);
const draft = (e, page, body) => json(e, `/portal/content/pages/${page}/draft`, body);

const HOURS = { days: ['1', '2', '3', '4', '5'], open: '9', close: '17', hours: 'Monday to Friday, 9 a.m. to 5 p.m.', walkIn: 'Walk-ins are welcome.' };

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('page_revisions').del();
  await db('page_content').del();
  await db('media').del();
  await db('site_settings').whereNotIn('key', ['business.phone', 'business.email', 'business.address', 'business.hours']).del();
  await db('site_settings').where({ key: 'business.address' }).update({ value: JSON.stringify(defaults.address) });
  await db('site_settings').where({ key: 'business.email' }).update({ value: JSON.stringify(defaults.email) });
  await db('users').del();
  await resetRoles();
  content.clearCache();
  cms.clearCache();
});

afterAll(async () => {
  await db('page_content').del();
  await db('site_settings').whereNotIn('key', ['business.phone', 'business.email', 'business.address', 'business.hours']).del();
  content.clearCache();
  await db.destroy();
});

describe('page editor: access', () => {
  it('lists every page for Admin, each opening in the editor', async () => {
    const e = await editor('admin');
    const index = await e.agent.get('/portal/content');
    expect(index.status).toBe(200);
    for (const p of ['Home', 'About', 'Privacy Policy', 'Personal Supports', 'Send a referral']) expect(index.text).toContain(p);
    const shell = await e.agent.get('/portal/content/pages/home');
    expect(shell.status).toBe(200);
    expect(shell.text).toContain('/?cms=edit&amp;cms_page=home');
    expect(shell.text).toContain('data-publish');
  });

  it('lets Program Directors edit only the careers page (and office hours)', async () => {
    const e = await editor('program_director');
    const home = await e.agent.get('/portal/content/pages/home');
    expect(home.text).toContain('View only');
    expect(home.text).not.toContain('data-publish');
    const res = await draft(e, 'home', { values: [{ key: 'home.hero.title', type: 'text', value: 'Hacked' }] });
    expect(res.status).toBe(422);
    expect(res.body.error).toMatch(/can’t change/);
    expect((await draft(e, 'careers', { values: [{ key: 'careers.hero.title', type: 'text', value: 'Grow with HLO' }] })).status).toBe(200);
    // Shared header/footer text is off limits too.
    expect((await draft(e, 'careers', { values: [{ key: 'site.footer.blurb', type: 'text', value: 'x' }] })).status).toBe(422);
    expect((await post(e.agent, '/portal/content/hours', '/portal/content/hours', HOURS)).status).toBe(303);
  });

  it('keeps roles without content access out', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await coordinator.get('/portal/content')).status).toBe(403);
    expect((await coordinator.get('/?cms=edit')).status).toBe(302);
  });

  it('only shows edit mode to signed-in editors, framed by our own site', async () => {
    const anon = await request(app).get('/?cms=edit');
    expect(anon.status).toBe(302);
    expect(anon.headers.location).toContain('/portal/login');
    const live = await request(app).get('/');
    expect(live.text).not.toContain('data-cms=');
    expect(live.headers['content-security-policy']).toContain("frame-ancestors 'none'");

    const e = await editor('admin');
    const edit = await e.agent.get('/?cms=edit&cms_page=home');
    expect(edit.status).toBe(200);
    expect(edit.text).toContain('data-cms="home.hero.title"');
    expect(edit.text).toContain('id="cms-registry"');
    expect(edit.text).toContain('/js/cms-frame.js');
    expect(edit.headers['content-security-policy']).toContain("frame-ancestors 'self'");
    expect(edit.headers['x-robots-tag']).toContain('noindex');
  });
});

describe('page editor: draft, preview, publish', () => {
  it('saves to a draft that only staff see until it is published', async () => {
    const e = await editor('admin');
    const res = await draft(e, 'home', { values: [{ key: 'home.hero.title', type: 'text', value: 'Living well, your way.' }] });
    expect(res.status).toBe(200);
    expect((await request(app).get('/')).text).not.toContain('Living well, your way.');
    expect((await e.agent.get('/?cms=preview')).text).toContain('Living well, your way.');
    expect((await e.agent.get('/portal/content/pages/home/status?docs=home')).body.pending).toEqual(['home']);

    const pub = await json(e, '/portal/content/pages/home/publish', { docs: ['home'] });
    expect(pub.body.published).toEqual(['home']);
    expect((await request(app).get('/')).text).toContain('Living well, your way.');
    expect(await db('page_revisions').where({ page_key: 'home' }).first()).toBeTruthy();
    expect(await db('audit_log').where({ action: 'content.publish' }).first()).toBeTruthy();
  });

  it('publishes shared header and footer changes with the page', async () => {
    const e = await editor('admin');
    await draft(e, 'about', { values: [{ key: 'site.footer.blurb', type: 'text', value: 'Supporting Maryland since 2010.' }] });
    await json(e, '/portal/content/pages/about/publish', { docs: ['about', 'site'] });
    expect((await request(app).get('/contact')).text).toContain('Supporting Maryland since 2010.');
  });

  it('discards a draft, and restores an earlier version', async () => {
    const e = await editor('admin');
    await draft(e, 'about', { values: [{ key: 'about.hero.title', type: 'text', value: 'Version one' }] });
    await json(e, '/portal/content/pages/about/publish', { docs: ['about'] });
    await draft(e, 'about', { values: [{ key: 'about.hero.title', type: 'text', value: 'Version two' }] });
    await json(e, '/portal/content/pages/about/publish', { docs: ['about'] });

    await draft(e, 'about', { values: [{ key: 'about.hero.title', type: 'text', value: 'Oops' }] });
    await json(e, '/portal/content/pages/about/discard', { docs: ['about'] });
    expect((await e.agent.get('/about?cms=preview')).text).toContain('Version two');

    const { versions } = (await e.agent.get('/portal/content/pages/about/history')).body;
    expect(versions).toHaveLength(2);
    await json(e, '/portal/content/pages/about/restore', { revision: versions[1].id });
    expect((await e.agent.get('/about?cms=preview')).text).toContain('Version one');
    expect((await request(app).get('/about')).text).toContain('Version two'); // still live until published
  });

  it('puts a page back to its original design', async () => {
    const e = await editor('admin');
    await draft(e, 'home', { values: [{ key: 'home.hero.title', type: 'text', value: 'Temporary' }] });
    await json(e, '/portal/content/pages/home/publish', { docs: ['home'] });
    await json(e, '/portal/content/pages/home/reset', {});
    await json(e, '/portal/content/pages/home/publish', { docs: ['home'] });
    expect((await request(app).get('/')).text).toContain(pages.home.title);
  });
});

describe('page editor: lists, sections, images, links', () => {
  it('edits, reorders and removes repeated items', async () => {
    const e = await editor('admin');
    const items = [
      { title: 'We plan together', text: 'Second becomes first.' },
      { title: 'We listen', text: 'First becomes second.' },
    ];
    expect((await draft(e, 'home', { lists: [{ key: 'home.approach.steps', items }] })).status).toBe(200);
    const preview = (await e.agent.get('/?cms=preview')).text;
    expect(preview.indexOf('We plan together')).toBeLessThan(preview.indexOf('We listen'));
    expect(preview).not.toContain('We support and grow');
    expect((await draft(e, 'home', { lists: [{ key: 'home.approach.steps', items: [] }] })).status).toBe(422); // at least one item
  });

  it('hides and reorders sections', async () => {
    const e = await editor('admin');
    await draft(e, 'home', { sections: [{ doc: 'home', order: ['facts', 'hero'], hidden: ['paths'] }] });
    const preview = (await e.agent.get('/?cms=preview')).text;
    expect(preview).not.toContain('How can we help today?');
    expect(preview.indexOf('HLO at a glance')).toBeLessThan(preview.indexOf(pages.home.title));
    // In the editor, hidden sections still show (faded) so they can be shown again.
    expect((await e.agent.get('/?cms=edit')).text).toContain('data-cms-hidden="1"');
  });

  it('accepts only safe links and our own images', async () => {
    const e = await editor('admin');
    for (const value of ['javascript:alert(1)', '//evil.com', 'http://example.com', 'data:text/html,x']) {
      expect((await draft(e, 'home', { values: [{ key: 'home.hero.cta1.href', type: 'href', value }] })).status).toBe(422);
    }
    for (const value of ['/contact', '#compare', 'https://health.maryland.gov/dda', 'mailto:info@hloinc.com', 'tel:410-874-8551']) {
      expect((await draft(e, 'home', { values: [{ key: 'home.hero.cta1.href', type: 'href', value }] })).status).toBe(200);
    }
    const badImage = { src: 'https://evil.com/x.webp', alt: '' };
    expect((await draft(e, 'home', { values: [{ key: 'home.hero.image', type: 'image', value: badImage }] })).status).toBe(422);
    const good = { src: '/img/photos/approach.webp', srcSm: '/img/photos/approach-sm.webp', alt: 'A calm conversation', w: 960, h: 640 };
    expect((await draft(e, 'home', { values: [{ key: 'home.hero.image', type: 'image', value: good }] })).status).toBe(200);
    expect((await e.agent.get('/?cms=preview')).text).toContain('alt="A calm conversation"');
    // Items can't smuggle in unknown icons or bad links.
    expect((await draft(e, 'home', { lists: [{ key: 'home.paths.items', items: [{ title: 'x', text: 'y', icon: 'nope', href: '/' }] }] })).status).toBe(422);
    expect((await draft(e, 'home', { lists: [{ key: 'home.paths.items', items: [{ title: 'x', text: 'y', icon: 'heart', href: 'javascript:x' }] }] })).status).toBe(422);
  });

  it('escapes anything that looks like code', async () => {
    const e = await editor('admin');
    await draft(e, 'home', { values: [{ key: 'home.hero.title', type: 'text', value: 'Hello <script>alert(1)</script>' }, { key: 'home.hero.intro', type: 'text', value: '"><img src=x onerror=alert(1)>' }] });
    const html = (await e.agent.get('/?cms=preview')).text;
    expect(html).not.toContain('<script>alert(1)</script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });

  it('edits page titles for browser tabs and search results', async () => {
    const e = await editor('admin');
    await draft(e, 'about', { values: [{ key: 'about.meta.title', type: 'plain', value: 'About our team' }] });
    expect((await e.agent.get('/about?cms=preview')).text).toContain('<title>About our team | ');
  });

  it('edits legal page sections', async () => {
    const e = await editor('admin');
    const res = await draft(e, 'privacy', { lists: [{ key: 'privacy.sections', items: [{ id: 'scope', heading: 'Who we are', body: 'First paragraph.\n\n- A bullet' }] }] });
    expect(res.status).toBe(200);
    const html = (await e.agent.get('/privacy?cms=preview')).text;
    expect(html).toContain('Who we are');
    expect(html).toContain('<li>A bullet</li>');
  });
});

describe('media library', () => {
  it('uploads a photo as resized WebP files, and protects images in use', async () => {
    const e = await editor('admin');
    const sharp = require('sharp');
    const png = await sharp({ create: { width: 2400, height: 1600, channels: 3, background: '#189f67' } }).png().toBuffer();
    const up = await e.agent.post('/portal/content/media').set('Accept', 'application/json').set('x-csrf-token', e.token).attach('file', png, 'team.png').field('alt', 'Our team');
    expect(up.status).toBe(200);
    const { image, id } = up.body.item;
    expect(image.src).toMatch(/^\/uploads\/[a-f0-9]{16}\.webp$/);
    expect(image.w).toBe(1600);
    const file = path.join(config.paths.storage, 'uploads', path.basename(image.src));
    expect(fs.existsSync(file)).toBe(true);
    expect((await request(app).get(image.src)).status).toBe(200);

    // Not a photo: refused.
    const bad = await e.agent.post('/portal/content/media').set('Accept', 'application/json').set('x-csrf-token', e.token).attach('file', Buffer.from('<svg onload=alert(1)>'), { filename: 'x.png', contentType: 'image/png' });
    expect(bad.status).toBe(422);

    // In use on a draft: can't be deleted. Once unused: deleted with its files.
    await draft(e, 'home', { values: [{ key: 'home.hero.image', type: 'image', value: image }] });
    expect((await json(e, `/portal/content/media/${id}/delete`, {})).status).toBe(409);
    await json(e, '/portal/content/pages/home/discard', { docs: ['home'] });
    expect((await json(e, `/portal/content/media/${id}/delete`, {})).status).toBe(200);
    expect(fs.existsSync(file)).toBe(false);
  });
});

describe('business details', () => {
  it('updates office hours and the open/closed schedule', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    expect((await post(admin, '/portal/content/hours', '/portal/content/hours', { ...HOURS, open: '17', close: '9' })).status).toBe(422);
    await post(admin, '/portal/content/hours', '/portal/content/hours', { ...HOURS, days: ['1', '2', '3', '4', '5', '6'], close: '18', hours: 'Monday to Saturday, 9 a.m. to 6 p.m.' });
    const business = await content.getBusiness();
    expect(business.schedule).toEqual({ days: [1, 2, 3, 4, 5, 6], open: 9, close: 18 });
    expect((await request(app).get('/contact')).text).toContain('Monday to Saturday, 9 a.m. to 6 p.m.');
  });

  it('updates contact details, checking each one', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const form = { phone: '410-874-8551', email: 'info@hloinc.com', street: '4 East Rolling Crossroads', city: 'Catonsville', state: 'md', zip: '21228' };
    expect((await post(admin, '/portal/content/contact', '/portal/content/contact', { ...form, email: 'nope' })).status).toBe(422);
    expect((await post(admin, '/portal/content/contact', '/portal/content/contact', { ...form, zip: '2122' })).status).toBe(422);
    await post(admin, '/portal/content/contact', '/portal/content/contact', form);
    expect((await content.getBusiness()).address).toMatchObject({ state: 'MD', zip: '21228' });
    expect((await request(app).get('/contact')).text).toContain('21228');
  });

  it('routes each contact form choice to its own email address', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/content/recipients', '/portal/content/recipients', { intake: 'Intake@HLOinc.com', general: '' });
    expect(await content.getRecipientEmail('intake')).toBe('intake@hloinc.com');
    expect(await content.getRecipientEmail('general')).toBe(defaults.email);
    expect((await post(admin, '/portal/content/recipients', '/portal/content/recipients', { intake: 'not-an-email' })).status).toBe(422);
  });
});
