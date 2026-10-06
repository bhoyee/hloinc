import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createApp, db, formAgent, nextWeekday, nextWeekend, todayInMaryland } from './helpers.js';

const app = createApp();

afterAll(() => db.destroy());

describe('public pages', () => {
  it.each([
    ['/', 'Support for living well'],
    ['/about', 'Our mission'],
    ['/services', 'Personal Supports'],
    ['/services/respite-care', 'What support can include'],
    ['/service-areas', 'St. Mary’s County'],
    ['/getting-started', 'Talk to us about intake'],
    ['/resources', 'independent of HLO'],
    ['/careers', 'Open positions'],
    ['/contact', 'Send us a message'],
    ['/appointments/request', 'Request an appointment'],
  ])('%s renders', async (path, text) => {
    const res = await request(app).get(path);
    expect(res.status).toBe(200);
    expect(res.text).toContain(text);
  });

  it('lists exactly the five non-nursing services', async () => {
    const res = await request(app).get('/services');
    const names = [...res.text.matchAll(/<h2 class="text-2xl font-bold"><a href="\/services\/([a-z-]+)"/g)].map((m) => m[1]);
    expect(names).toHaveLength(5);
    expect(res.text).not.toMatch(/nursing|transportation/i);
  });

  it('shows the ten counties', async () => {
    const res = await request(app).get('/service-areas');
    expect(res.text.match(/County|Baltimore City/g).length).toBeGreaterThanOrEqual(10);
  });

  it('lists the contact recipients in the required order', async () => {
    const res = await request(app).get('/contact');
    const options = [...res.text.matchAll(/<option value="([a-z_]+)"/g)].map((m) => m[1]);
    expect(options).toEqual(['general', 'program_coordinator', 'program_director', 'executive', 'intake']);
  });

  it('preselects the intake recipient from ?to=intake', async () => {
    const res = await request(app).get('/contact?to=intake');
    expect(res.text).toMatch(/<option value="intake" selected>/);
  });

  it('serves robots.txt and a sitemap that hide the portal', async () => {
    const robots = await request(app).get('/robots.txt');
    expect(robots.text).toContain('Disallow: /portal');
    const sitemap = await request(app).get('/sitemap.xml');
    expect(sitemap.text).toContain('/services/personal-supports');
    expect(sitemap.text).not.toContain('/portal');
  });
});

describe('legacy WordPress URLs', () => {
  it.each([
    ['/about-hlo-inc/', '/about'],
    ['/contact-us/', '/contact'],
    ['/schedule-an-appointment/', '/appointments/request'],
    ['/send-your-referrals/', '/getting-started#referrals'],
    ['/services/', '/services'],
  ])('%s redirects permanently to %s', async (from, to) => {
    const res = await request(app).get(from);
    expect(res.status).toBe(301);
    expect(res.headers.location).toBe(to);
  });

  it.each(['/shop/cart/', '/blog/single-post/', '/about-hlo-inc/doctors-profile/', '/wp-login.php'])(
    '%s is gone (410)',
    async (path) => {
      expect((await request(app).get(path)).status).toBe(410);
    }
  );

  it('never redirects off-site', async () => {
    const res = await request(app).get('//evil.example/');
    expect(res.headers.location || '').not.toMatch(/^\/\//);
  });
});

describe('contact form', () => {
  beforeEach(() => db('contact_messages').del());

  const valid = {
    recipient: 'intake',
    name: 'Pat Example',
    email: 'pat@example.com',
    phone: '410-555-0123',
    message: 'I would like to learn about personal supports.',
  };

  it('saves a valid message and emails the recipient', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(303);

    const rows = await db('contact_messages');
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ recipient: 'intake', email: 'pat@example.com', status: 'new', email_status: 'sent' });

    const page = await agent.get('/contact');
    expect(page.text).toContain('Your message has been sent');
  });

  it('shows field errors and keeps what was typed', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .type('form')
      .send({ ...valid, email: 'not-an-email', message: 'short', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Enter a valid email address');
    expect(res.text).toContain('at least 10 characters');
    expect(res.text).toContain('value="Pat Example"');
    expect(res.text).toMatch(/id="f-email"[^>]*aria-invalid="true"/);
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('rejects an unknown recipient', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, recipient: 'ceo@evil', _csrf: csrf });
    expect(res.status).toBe(422);
  });

  it('silently drops honeypot submissions', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent.post('/contact').type('form').send({ ...valid, website: 'http://spam', _csrf: csrf });
    expect(res.status).toBe(303);
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('escapes HTML in what visitors type', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .type('form')
      .send({ ...valid, name: '<script>alert(1)</script>', email: 'bad', _csrf: csrf });
    expect(res.text).not.toContain('<script>alert(1)</script>');
    expect(res.text).toContain('&lt;script&gt;');
  });
});

describe('appointment requests', () => {
  let typeId;

  beforeEach(async () => {
    await db('appointments').del();
    typeId = (await db('appointment_types').where({ active: true }).first()).id;
  });

  const base = () => ({
    type_id: String(typeId),
    name: 'Sam Example',
    email: 'sam@example.com',
    phone: '',
    preferred_contact: 'email',
    requested_date: nextWeekday(1),
    requested_window: 'morning',
    notes: '',
    consent: 'yes',
  });

  it('saves a valid request as Requested from the website', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent.post('/appointments/request').type('form').send({ ...base(), _csrf: csrf });
    expect(res.status).toBe(303);

    const [row] = await db('appointments');
    expect(row).toMatchObject({ source: 'website', status: 'requested', requested_window: 'morning' });
  });

  it.each([
    ['today', () => todayInMaryland(), 'at least one day in advance'],
    ['a weekend', () => nextWeekend(), 'Choose a weekday'],
    ['too far ahead', () => nextWeekday(120), 'within the next 90 days'],
  ])('rejects a date that is %s', async (_, date, message) => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), requested_date: date(), _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain(message);
    expect(await db('appointments')).toHaveLength(0);
  });

  it('requires a phone number when phone contact is preferred', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), preferred_contact: 'phone', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Enter a phone number so we can call you');
  });

  it('rejects inactive or unknown appointment types', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const res = await agent
      .post('/appointments/request')
      .type('form')
      .send({ ...base(), type_id: '99999', _csrf: csrf });
    expect(res.status).toBe(422);
  });

  it('requires consent', async () => {
    const { agent, csrf } = await formAgent(app, '/appointments/request');
    const { consent, ...rest } = base();
    const res = await agent.post('/appointments/request').type('form').send({ ...rest, _csrf: csrf });
    expect(res.status).toBe(422);
  });
});

describe('careers', () => {
  beforeEach(async () => {
    await db('jobs').del();
    await db('jobs').insert([
      {
        title: 'Direct Support Professional',
        slug: 'direct-support-professional',
        description: 'Support adults in the community.',
        apply_url: 'https://workforcenow.adp.com/example',
        status: 'published',
        published_at: new Date(),
      },
      {
        title: 'Secret Draft Role',
        slug: 'secret-draft-role',
        description: 'Not yet live.',
        apply_url: 'https://workforcenow.adp.com/draft',
        status: 'draft',
      },
    ]);
  });

  it('lists only published jobs', async () => {
    const res = await request(app).get('/careers');
    expect(res.text).toContain('Direct Support Professional');
    expect(res.text).not.toContain('Secret Draft Role');
  });

  it('shows a published job with its ADP apply link', async () => {
    const res = await request(app).get('/careers/direct-support-professional');
    expect(res.status).toBe(200);
    expect(res.text).toContain('href="https://workforcenow.adp.com/example"');
  });

  it('hides draft jobs', async () => {
    expect((await request(app).get('/careers/secret-draft-role')).status).toBe(404);
  });
});

describe('announcements', () => {
  beforeEach(() => db('announcements').del());

  it('shows only current public announcements on the home page', async () => {
    const day = 24 * 60 * 60 * 1000;
    await db('announcements').insert([
      { title: 'Office closed Monday', body: 'Holiday.', audience: 'public', starts_at: new Date(Date.now() - day) },
      { title: 'Staff meeting', body: 'Internal.', audience: 'internal', starts_at: new Date(Date.now() - day) },
      {
        title: 'Old news',
        body: 'Expired.',
        audience: 'both',
        starts_at: new Date(Date.now() - 3 * day),
        ends_at: new Date(Date.now() - day),
      },
      { title: 'Future news', body: 'Not yet.', audience: 'public', starts_at: new Date(Date.now() + day) },
    ]);
    const res = await request(app).get('/');
    expect(res.text).toContain('Office closed Monday');
    expect(res.text).not.toContain('Staff meeting');
    expect(res.text).not.toContain('Old news');
    expect(res.text).not.toContain('Future news');
  });
});
