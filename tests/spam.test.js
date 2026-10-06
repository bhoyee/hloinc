import { describe, it, expect, beforeEach, afterEach, afterAll, vi } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db, formAgent } from './helpers.js';

const require = createRequire(import.meta.url);
const config = require('../src/config');
const spam = require('../src/lib/spam');

const app = createApp();

const valid = {
  recipient: 'general',
  name: 'Pat Example',
  email: 'pat@example.com',
  phone: '',
  message: 'I would like to learn more about your services.',
};

async function send(body, appUnderTest = app) {
  const { agent, csrf } = await formAgent(appUnderTest, '/contact');
  return agent.post('/contact').type('form').send({ ...body, _csrf: csrf });
}

const saved = () => db('contact_messages').count({ n: '*' }).first().then((r) => Number(r.n));

beforeEach(async () => {
  spam._reset();
  await db('contact_messages').del();
});

afterAll(() => db.destroy());

describe('bot signals', () => {
  it.each(['website', 'email_confirm'])('drops submissions that fill the %s honeypot', async (field) => {
    const res = await send({ ...valid, [field]: 'spam' });
    expect(res.status).toBe(303); // looks like success to the bot
    expect(await saved()).toBe(0);
  });

  it('drops a replayed submission (each form token works once)', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    await agent.post('/contact').type('form').send({ ...valid, _csrf: csrf });
    await agent.post('/contact').type('form').send({ ...valid, message: 'Replay with new text here.', _csrf: csrf });
    expect(await saved()).toBe(1);
  });

  it('drops messages stuffed with links', async () => {
    const message = 'Great site! https://spam.example/a https://spam.example/b www.spam.example';
    await send({ ...valid, message });
    expect(await saved()).toBe(0);
  });

  it('drops HTML or BBCode link markup', async () => {
    await send({ ...valid, message: 'Hello <a href="https://spam.example">cheap</a> deals' });
    await send({ ...valid, message: 'Hello [url=https://spam.example]cheap[/url] deals' });
    expect(await saved()).toBe(0);
  });

  it('allows a message with one or two links', async () => {
    await send({ ...valid, message: 'My coordinator is at https://agency.example — please contact them.' });
    expect(await saved()).toBe(1);
  });
});

describe('timing', () => {
  const original = config.forms.minSubmitSeconds;
  afterEach(() => {
    config.forms.minSubmitSeconds = original;
  });

  it('flags forms submitted faster than a person could', () => {
    config.forms.minSubmitSeconds = 3;
    const req = { session: {}, body: {} };
    spam.issueForm(req, 'contact');
    expect(spam.botCheck(req, 'contact')).toBe('too fast');
  });

  it('keeps the original time when a form is re-shown after a typo', () => {
    config.forms.minSubmitSeconds = 3;
    const req = { session: { formIssued: { contact: Date.now() - 10_000 } }, body: {} };
    expect(spam.botCheck(req, 'contact')).toBeNull();
    // Validation failed: the form is rendered again on the same request…
    spam.issueForm(req, 'contact');
    // …so a quick correction is still accepted.
    const next = { session: req.session, body: {} };
    expect(spam.botCheck(next, 'contact')).toBeNull();
  });

  it('a corrected form submits after a validation error', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const bad = await agent.post('/contact').type('form').send({ ...valid, email: 'nope', _csrf: csrf });
    expect(bad.status).toBe(422);
    const ok = await agent.post('/contact').type('form').send({ ...valid, _csrf: csrf });
    expect(ok.status).toBe(303);
    expect(await saved()).toBe(1);
  });
});

describe('repeats', () => {
  it('drops the same message sent twice in a row', async () => {
    await send(valid);
    await send(valid);
    expect(await saved()).toBe(1);
  });

  it('tells a person when one email has sent too many today', async () => {
    for (let i = 0; i < config.forms.maxPerEmailPerDay; i++) {
      await send({ ...valid, message: `Question number ${i} about services.` });
    }
    const res = await send({ ...valid, message: 'One more question about services.' });
    expect(res.status).toBe(422);
    expect(res.text).toContain('please call us');
    expect(await saved()).toBe(config.forms.maxPerEmailPerDay);
  });
});

describe('cross-site posts', () => {
  it('rejects a post from another website (Origin)', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .set('Origin', 'https://evil.example')
      .type('form')
      .send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(403);
    expect(await saved()).toBe(0);
  });

  it('rejects a post the browser marks as cross-site', async () => {
    const { agent, csrf } = await formAgent(app, '/contact');
    const res = await agent
      .post('/contact')
      .set('Sec-Fetch-Site', 'cross-site')
      .type('form')
      .send({ ...valid, _csrf: csrf });
    expect(res.status).toBe(403);
  });
});

describe('Cloudflare Turnstile (optional)', () => {
  const original = { ...config.turnstile };
  let turnstileApp;

  beforeEach(() => {
    Object.assign(config.turnstile, { enabled: true, siteKey: 'site-key-test', secretKey: 'secret-test' });
    turnstileApp = createApp();
  });
  afterEach(() => {
    Object.assign(config.turnstile, original);
    vi.unstubAllGlobals();
  });

  it('is off by default: no widget and a strict CSP', async () => {
    Object.assign(config.turnstile, original);
    const res = await request(createApp()).get('/contact');
    expect(res.text).not.toContain('cf-turnstile');
    expect(res.headers['content-security-policy']).not.toContain('challenges.cloudflare.com');
  });

  it('when on, shows the widget and allows Cloudflare in the CSP', async () => {
    const res = await request(turnstileApp).get('/contact');
    expect(res.text).toContain('data-sitekey="site-key-test"');
    expect(res.headers['content-security-policy']).toContain('https://challenges.cloudflare.com');
  });

  it('when on, the Privacy Policy describes it', async () => {
    const res = await request(turnstileApp).get('/privacy');
    expect(res.text).toContain('Security check by Cloudflare');
  });

  it('rejects a failed check and asks the person to try again', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: false }) })));
    const res = await send({ ...valid, 'cf-turnstile-response': 'bad-token' }, turnstileApp);
    expect(res.status).toBe(422);
    expect(res.text).toContain('complete the security check');
    expect(await saved()).toBe(0);
  });

  it('accepts a passed check', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => ({ json: async () => ({ success: true }) })));
    const res = await send({ ...valid, 'cf-turnstile-response': 'good-token' }, turnstileApp);
    expect(res.status).toBe(303);
    expect(await saved()).toBe(1);
  });

  it('lets submissions through if Cloudflare is unreachable', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new Error('network down'); }));
    const errors = vi.spyOn(console, 'error').mockImplementation(() => {});
    const res = await send({ ...valid, 'cf-turnstile-response': 'any' }, turnstileApp);
    expect(res.status).toBe(303);
    expect(await saved()).toBe(1);
    errors.mockRestore();
  });
});
