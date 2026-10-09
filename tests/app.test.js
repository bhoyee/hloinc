import { describe, it, expect } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const { createApp } = require('../src/server');

const app = createApp();

describe('public site', () => {
  it('renders the home page with business details', async () => {
    const res = await request(app).get('/');
    expect(res.status).toBe(200);
    expect(res.text).toContain('Healthy Living Option Inc.');
    expect(res.text).toContain('410-874-8551');
  });

  it('returns a 404 page for unknown routes', async () => {
    const res = await request(app).get('/no-such-page');
    expect(res.status).toBe(404);
    expect(res.text).toContain("couldn't find that page");
  });

  it('reports liveness', async () => {
    const res = await request(app).get('/healthz');
    expect(res.status).toBe(200);
    expect(res.body).toEqual({ status: 'ok' });
  });
});

describe('security', () => {
  it('sends a strict Content Security Policy and no x-powered-by', async () => {
    const res = await request(app).get('/');
    expect(res.headers['content-security-policy']).toContain("script-src 'self'");
    expect(res.headers['content-security-policy']).toContain("frame-ancestors 'none'");
    expect(res.headers['x-powered-by']).toBeUndefined();
  });

  it('rejects form posts without a CSRF token, explaining instead of erroring', async () => {
    const agent = request.agent(app);
    const res = await agent.post('/contact').type('form').set('Referer', 'http://127.0.0.1/contact').set('Host', '127.0.0.1').send({ message: 'hi' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/contact');
    const page = await agent.get('/contact').set('Host', '127.0.0.1');
    expect(page.text).toContain('for your security nothing was sent');
  });

  it('gives background requests a plain 403 for a bad token', async () => {
    const res = await request(app).post('/contact').set('Accept', 'application/json').type('form').send({ message: 'hi' });
    expect(res.status).toBe(403);
  });

  it('never sends people back to another site after a stale form', async () => {
    const res = await request(app).post('/contact').type('form').set('Referer', 'https://evil.example/phish').send({});
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/');
  });

  it('sends a signed-out portal form to sign-in, then back to the page', async () => {
    const res = await request(app).post('/portal/jobs/5').type('form').set('Host', '127.0.0.1').set('Referer', 'http://127.0.0.1/portal/jobs/5').send({ _csrf: 'old' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/login?ended=expired&next=%2Fportal%2Fjobs%2F5');
  });

  it('keeps a preview copy out of search engines when NOINDEX is set', async () => {
    const config = require('../src/config');
    config.noindex = true;
    try {
      const preview = createApp();
      const home = await request(preview).get('/');
      expect(home.headers['x-robots-tag']).toBe('noindex, nofollow');
      expect((await request(preview).get('/robots.txt')).text).toMatch(/^Disallow: \/$/m);
    } finally {
      config.noindex = false;
    }
    expect((await request(app).get('/robots.txt')).text).toContain('Sitemap:');
  });

  it('keeps the staff portal out of search engines', async () => {
    const res = await request(app).get('/portal');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
