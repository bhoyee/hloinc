import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const content = require('../src/services/content');
const pages = require('../src/content/pages');
const { defaults } = require('../src/lib/site');

const app = createApp();

/** The page form as it stands, with some fields changed. */
function pageForm(key, changes = {}) {
  const page = pages[key];
  const body = {};
  for (const [k, v] of Object.entries(page)) {
    if (typeof v === 'string') body[k] = v;
    else if (Array.isArray(v) && typeof v[0] === 'string') body[k] = v.join('\n');
    else if (Array.isArray(v)) v.forEach((item, i) => Object.entries(item).forEach(([p, val]) => (body[`${k}__${i}__${p}`] = val)));
  }
  return { ...body, ...changes };
}

const HOURS = { days: ['1', '2', '3', '4', '5'], open: '9', close: '17', hours: 'Monday to Friday, 9 a.m. to 5 p.m.', walkIn: 'Walk-ins are welcome.' };

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('site_settings').whereNotIn('key', ['business.phone', 'business.email', 'business.address', 'business.hours']).del();
  await db('site_settings').where({ key: 'business.address' }).update({ value: JSON.stringify(defaults.address) });
  await db('site_settings').where({ key: 'business.email' }).update({ value: JSON.stringify(defaults.email) });
  await db('users').del();
  await resetRoles();
  content.clearCache();
});

afterAll(async () => {
  await db('site_settings').whereNotIn('key', ['business.phone', 'business.email', 'business.address', 'business.hours']).del();
  content.clearCache();
  await db.destroy();
});

describe('site content: access', () => {
  it('lets Admin edit everything', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const index = await admin.get('/portal/content');
    expect(index.status).toBe(200);
    expect(index.text).toContain('Home page');
    expect(index.text).not.toContain('View only');
  });

  it('limits Program Directors to careers text and office hours', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    const index = await director.get('/portal/content');
    expect(index.text).toContain('View only');
    expect((await director.get('/portal/content/home')).text).toContain('can see this section but not change it');
    expect((await post(director, '/portal/content/home', '/portal/content/home', pageForm('home', { title: 'Hacked' }))).status).toBe(403);
    expect((await post(director, '/portal/content/careers', '/portal/content/careers', pageForm('careers', { title: 'Grow your career with HLO' }))).status).toBe(303);
    expect((await request(app).get('/careers')).text).toContain('Grow your career with HLO');
    expect((await post(director, '/portal/content/hours', '/portal/content/hours', HOURS)).status).toBe(303);
  });

  it('keeps roles without content access out', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await coordinator.get('/portal/content')).status).toBe(403);
  });
});

describe('site content: pages', () => {
  it('changes page text on the website and records old and new text', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const res = await post(admin, '/portal/content/home', '/portal/content/home', pageForm('home', { title: 'Living well, your way.' }));
    expect(res.status).toBe(303);
    expect((await request(app).get('/')).text).toContain('Living well, your way.');
    const entry = await db('audit_log').where({ action: 'content.update' }).first();
    const meta = JSON.parse(entry.metadata);
    expect(meta.changed).toEqual(['title']);
    expect(meta.before.title).toBe(pages.home.title);
    expect(meta.after.title).toBe('Living well, your way.');
    // Only the changed text is stored.
    const saved = JSON.parse((await db('site_settings').where({ key: 'page.home' }).first()).value);
    expect(saved).toEqual({ title: 'Living well, your way.' });
  });

  it('edits lists and repeated items', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/content/careers', '/portal/content/careers', pageForm('careers', { why__0__title: 'Work with purpose' }));
    await post(admin, '/portal/content/about', '/portal/content/about', pageForm('about', { supportNeeds: 'Autism\nEpilepsy\n\n' }));
    expect((await request(app).get('/careers')).text).toContain('Work with purpose');
    const about = await content.getPage('about');
    expect(about.supportNeeds).toEqual(['Autism', 'Epilepsy']);
  });

  it('rejects empty and over-long text', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const empty = await post(admin, '/portal/content/home', '/portal/content/home', pageForm('home', { title: '  ' }));
    expect(empty.status).toBe(422);
    expect(empty.text).toContain('can’t be empty');
    const long = await post(admin, '/portal/content/home', '/portal/content/home', pageForm('home', { intro: 'x'.repeat(401) }));
    expect(long.status).toBe(422);
  });

  it('escapes anything that looks like code', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/content/home', '/portal/content/home', pageForm('home', { title: 'Hello <script>alert(1)</script>' }));
    const home = (await request(app).get('/')).text;
    expect(home).not.toContain('<script>alert(1)</script>');
    expect(home).toContain('&lt;script&gt;');
  });

  it('puts a page back to its original text', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/content/home', '/portal/content/home', pageForm('home', { title: 'Temporary title' }));
    await post(admin, '/portal/content/home', '/portal/content/home/reset');
    expect(await db('site_settings').where({ key: 'page.home' }).first()).toBeUndefined();
    expect((await request(app).get('/')).text).toContain(pages.home.title);
  });
});

describe('site content: business details', () => {
  it('updates office hours and the open/closed schedule', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    const backwards = await post(admin, '/portal/content/hours', '/portal/content/hours', { ...HOURS, open: '17', close: '9' });
    expect(backwards.status).toBe(422);
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
    const business = await content.getBusiness();
    expect(business.address).toMatchObject({ state: 'MD', zip: '21228' });
    expect((await request(app).get('/contact')).text).toContain('21228');
  });

  it('routes each contact form choice to its own email address', async () => {
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/content/recipients', '/portal/content/recipients', { intake: 'Intake@HLOinc.com', general: '' });
    expect(await content.getRecipientEmail('intake')).toBe('intake@hloinc.com');
    expect(await content.getRecipientEmail('general')).toBe(defaults.email); // blank = main email
    expect((await post(admin, '/portal/content/recipients', '/portal/content/recipients', { intake: 'not-an-email' })).status).toBe(422);
  });
});
