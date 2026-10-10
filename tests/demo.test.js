import { describe, it, expect, afterEach } from 'vitest';
import { createRequire } from 'module';

const require = createRequire(import.meta.url);
const demo = require('../src/db/demo');

const saved = { NODE_ENV: process.env.NODE_ENV, DEMO_DATA: process.env.DEMO_DATA, DEMO_PASSWORD: process.env.DEMO_PASSWORD };
afterEach(() => {
  for (const [k, v] of Object.entries(saved)) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
});

describe('demo data rules', () => {
  it('never adds demo data while testing', () => {
    process.env.NODE_ENV = 'test';
    expect(demo.allowed()).toBe(false);
  });

  it('adds demo data on a server only when DEMO_DATA=true', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_DATA;
    expect(demo.allowed()).toBe(false);
    process.env.DEMO_DATA = 'yes';
    expect(demo.allowed()).toBe(false);
    process.env.DEMO_DATA = 'true';
    expect(demo.allowed()).toBe(true);
  });

  it('never uses the password from this public repository on a server', () => {
    process.env.NODE_ENV = 'production';
    delete process.env.DEMO_PASSWORD;
    expect(demo.staffPassword()).toBeNull();
    process.env.DEMO_PASSWORD = 'short';
    expect(demo.staffPassword()).toBeNull();
    process.env.DEMO_PASSWORD = 'a-long-server-only-password';
    expect(demo.staffPassword()).toBe('a-long-server-only-password');
    process.env.NODE_ENV = 'development';
    expect(demo.staffPassword()).toBe('Portal-Demo-2026!');
  });

  it('only uses phone numbers reserved for fiction', () => {
    for (const i of [0, 7, 42, 99, 150]) expect(demo.phone(i)).toMatch(/^410-555-01\d\d$/);
  });
});
