import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db, formAgent } from './helpers.js';

const require = createRequire(import.meta.url);
const { phoneField } = require('../src/validation/phone');
const emailLayout = require('../src/lib/emailLayout');
const { _outbox: outbox } = require('../src/services/notify');
const spam = require('../src/lib/spam');
const reference = require('../src/lib/reference');

const app = createApp();

afterAll(() => db.destroy());

beforeEach(async () => {
  outbox.length = 0;
  spam._reset();
  await db('contact_messages').del();
});

describe('phone numbers', () => {
  const field = phoneField();
  it.each([
    ['4105550123', '(410) 555-0123'],
    ['(410) 555-0123', '(410) 555-0123'],
    ['+1 410 555 0123', '(410) 555-0123'],
    ['410.555.0123', '(410) 555-0123'],
  ])('accepts %s and saves it as %s', (input, saved) => {
    expect(field.parse(input)).toBe(saved);
  });

  it.each(['410-555-01234', '555-0123', '12345678901234567890', 'call me', '410-555-0123 ext 4'])('rejects %s', (input) => {
    expect(field.safeParse(input).success).toBe(false);
  });

  it('caps what can be typed in every phone box', async () => {
    const page = await request(app).get('/request-services');
    expect(page.text).toMatch(/name="phone" type="tel"[^>]*maxlength="20"[^>]*inputmode="tel"/);
  });
});

describe('branded emails', () => {
  const business = { legalName: 'Healthy Living Option Inc.', phone: '410-874-8551', email: 'info@hloinc.com', hours: 'Mon – Fri', address: { street: '4 E Rolling Crossroads', city: 'Catonsville', state: 'MD', zip: '21228' } };

  it('turns the plain text into headings, a details table, a list and links', () => {
    const html = emailLayout.render({
      subject: 'We received your request',
      text: 'Hello Robin,\n\nYOUR REQUEST\nReference: #12\nServices: Respite\n\n- First step\n- Second step\n\nCall 410-874-8551 or email info@hloinc.com.',
      business,
      cta: { label: 'Learn more', href: 'https://example.org/services' },
    });
    expect(html).toContain('>Your Request</p>');
    expect(html).toMatch(/<td[^>]*>Reference<\/td><td[^>]*>#12<\/td>/);
    expect(html).toContain('<li style="margin:0 0 6px">First step</li>');
    expect(html).toContain('href="tel:4108748551"');
    expect(html).toContain('href="mailto:info@hloinc.com"');
    expect(html).toContain('Learn more &rarr;');
    expect(html).toContain('4 E Rolling Crossroads, Catonsville, MD 21228');
  });

  it('never lets what a visitor typed become HTML', () => {
    const html = emailLayout.render({ subject: 'Hi <b>', text: 'Name: <script>alert(1)</script>\n\n<img src=x onerror=alert(1)>', business });
    expect(html).not.toContain('<script>');
    expect(html).not.toContain('<img src=x');
    expect(html).toContain('&lt;script&gt;');
  });
});

describe('form confirmations', () => {
  const request_ = {
    first_name: 'Robin', last_name: 'Example', phone: '(410) 555-0144', email: 'robin@example.com',
    preferred_contact: 'phone', best_time: 'morning', relationship: 'family', individual_first_name: 'Sam',
    county: 'Baltimore County', dda_eligibility: 'in_progress', pcp: 'not_sure', priority_category: '',
    services: ['respite-care'], message: '', consent: 'yes',
  };

  it('sends the family a branded confirmation, without eligibility details, and saves a tidy phone number', async () => {
    const { agent, csrf } = await formAgent(app, '/request-services');
    expect((await agent.post('/request-services').type('form').send({ ...request_, _csrf: csrf })).status).toBe(303);

    const [row] = await db('contact_messages');
    expect(row.phone).toBe('(410) 555-0144');

    const mail = outbox.find((m) => m.to === 'robin@example.com');
    expect(mail.subject).toBe('We received your request for services');
    expect(row.reference).toMatch(/^HLO-REQ-[2-9A-HJKMNP-Z]{6}$/);
    expect(mail.text).toContain(`Reference: ${row.reference}`);
    expect(mail.text).toContain('WHAT HAPPENS NEXT');
    expect(mail.html).toContain('<!doctype html>');
    expect(mail.html).toContain('/img/logo.png');
    expect(mail.text).not.toMatch(/eligib|priority|Person-Centered Plan/i);
    expect((await agent.get('/request-services')).text).toContain(`Your reference is ${row.reference}, and we have emailed you a confirmation`);
  });

  it('turns away a phone number that is too long', async () => {
    const { agent, csrf } = await formAgent(app, '/request-services');
    const res = await agent.post('/request-services').type('form').send({ ...request_, phone: '410-555-0144-999999', _csrf: csrf });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Enter a valid US phone number');
    expect(await db('contact_messages')).toHaveLength(0);
  });

  it('confirms a referral to the referrer', async () => {
    const { agent, csrf } = await formAgent(app, '/referrals');
    await agent.post('/referrals').type('form').send({
      referrer_name: 'Casey Coordinator', organization: 'Example Agency', referrer_role: 'ccs', referrer_phone: '410-555-0123',
      referrer_email: 'casey@agency.example', person_name: 'J.E.', county: 'Howard County', services: ['respite-care'], consent: 'yes', _csrf: csrf,
    });
    const mail = outbox.find((m) => m.to === 'casey@agency.example');
    expect(mail.subject).toBe('Thank you for your referral');
    expect(mail.text).toContain('Person referred: J.E.');
    const [row] = await db('contact_messages');
    expect(row.reference).toMatch(/^HLO-REF-/);
    expect(mail.text).toContain(`Reference: ${row.reference}`);
    expect(outbox.find((m) => m.to !== 'casey@agency.example').subject).toBe(`New referral ${row.reference} from Casey Coordinator`);
    expect(mail.html).toContain('Thank you for your referral');
  });

  it('confirms a contact message to the sender', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    await agent.post('/contact').type('form').send({ recipient: 'general', name: 'Pat Visitor', email: 'pat@example.com', phone: '', message: 'Hello there, a quick question.', consent: 'yes', _csrf: csrf });
    const mail = outbox.find((m) => m.to === 'pat@example.com');
    expect(mail.subject).toBe('We received your message');
    const [row] = await db('contact_messages');
    expect(row.reference).toMatch(/^HLO-MSG-/);
    expect((await agent.get('/contact')).text).toContain(`Your reference is ${row.reference}, and we have emailed you a confirmation`);
  });
});

describe('reference numbers', () => {
  it('are readable, typed by form, and never use look-alike characters', () => {
    const seen = new Set();
    for (let i = 0; i < 2000; i++) {
      const ref = reference.make('request');
      expect(ref).toMatch(reference.PATTERN);
      expect(ref.slice(8)).not.toMatch(/[01OIL]/);
      seen.add(ref);
    }
    expect(seen.size).toBeGreaterThan(1990);
    expect(reference.make('referral')).toMatch(/^HLO-REF-/);
    expect(reference.make('message')).toMatch(/^HLO-MSG-/);
    expect(reference.make('appointment')).toMatch(/^HLO-APT-/);
  });

  it('can be searched however staff type them', () => {
    for (const typed of ['HLO-REQ-7K3M9P', 'hlo req 7k3m9p', 'REQ-7K3M9P', '7k3m9p']) expect(reference.normalizeSearch(typed)).toBe('7K3M9P');
    expect(reference.normalizeSearch('Robin')).toBeNull();
  });

  it('draws again if a reference is already taken', async () => {
    const taken = reference.make('message');
    await db('contact_messages').insert({ type: 'message', recipient: 'general', name: 'A', email: 'a@example.com', message: 'x', reference: taken });
    const real = reference.make;
    let calls = 0;
    reference.make = (kind) => (calls++ === 0 ? taken : real(kind));
    try {
      const { reference: ref } = await reference.insertWithReference(db, 'contact_messages', { type: 'message', recipient: 'general', name: 'B', email: 'b@example.com', message: 'y' }, 'message');
      expect(ref).not.toBe(taken);
      expect(calls).toBe(2);
    } finally {
      reference.make = real;
    }
  });
});

describe('phone search', () => {
  it('finds a stored number however it is typed', async () => {
    const { orWherePhone } = require('../src/validation/phone');
    const [id] = await db('contact_messages').insert({ type: 'message', recipient: 'general', name: 'Phone Search', email: 'ps@example.com', phone: '(410) 555-0188', message: 'Hi', email_status: 'sent' });
    for (const q of ['410-555-0188', '4105550188', '(410) 555-0188', '555-0188', '+1 410 555 0188']) {
      const row = await db('contact_messages').where((w) => orWherePhone(w.where('id', 0), 'phone', q)).where({ id }).first();
      expect(row, q).toBeTruthy();
    }
    expect(await db('contact_messages').where((w) => orWherePhone(w.where('id', 0), 'phone', 'Phone')).where({ id }).first()).toBeUndefined();
    await db('contact_messages').where({ id }).del();
  });
});
