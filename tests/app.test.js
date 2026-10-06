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

  it('rejects form posts without a CSRF token', async () => {
    const res = await request(app).post('/contact').type('form').send({ message: 'hi' });
    expect(res.status).toBe(403);
  });

  it('keeps the staff portal out of search engines', async () => {
    const res = await request(app).get('/portal');
    expect(res.headers['x-robots-tag']).toBe('noindex, nofollow');
  });
});
