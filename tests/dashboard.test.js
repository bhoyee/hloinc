import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const roles = require('../src/services/roles');
const config = require('../src/config');
const { DEFAULT_ROLES, normalize } = require('../src/auth/permissions');
const { marylandDateTime, addDaysIso, marylandParts } = require('../src/lib/hours');

const app = createApp();
const PASSWORD = 'correct horse battery';
const csrfFrom = (html) => (html.match(/name="_csrf" value="([a-f0-9]+)"/) || [])[1];

const SCHEDULE_DEFAULTS = {
  admin: { mode: 'all' },
  program_director: { mode: 'roles', roles: ['program_coordinator', 'intake_specialist', 'reception'] },
  program_coordinator: { mode: 'roles', roles: ['intake_specialist', 'reception'] },
};

async function resetRoles() {
  await db('roles').whereNotIn('key', DEFAULT_ROLES.map((r) => r.key)).del();
  for (const r of DEFAULT_ROLES) {
    const row = await db('roles').where({ key: r.key }).first();
    await db('roles').where({ id: row.id }).update({ require_mfa: false, schedule_scope: JSON.stringify(SCHEDULE_DEFAULTS[r.key] || { mode: 'own' }) });
    await db('role_permissions').where({ role_id: row.id }).del();
    await db('role_permissions').insert(normalize(r.permissions).map((permission) => ({ role_id: row.id, permission })));
  }
  roles.clearCache();
}

async function makeUser(role) {
  const [id] = await db('users').insert({
    name: `${role} person`,
    email: `${role}-${Math.random().toString(36).slice(2, 8)}@example.com`,
    role,
    password_hash: await bcrypt.hash(PASSWORD, 4),
  });
  return db('users').where({ id }).first();
}

async function signIn(user) {
  const agent = request.agent(app);
  const page = await agent.get('/portal/login');
  await agent.post('/portal/login').type('form').send({ email: user.email, password: PASSWORD, _csrf: csrfFrom(page.text) });
  return agent;
}

const today = () => marylandParts(new Date()).date;
let typeId;

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('shifts').del();
  await db('appointments').del();
  await db('contact_messages').del();
  await db('password_tokens').del();
  await db('users').del();
  await db('appointment_types').del();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  await resetRoles();
});

afterAll(() => db.destroy());

describe('dashboard page', () => {
  it('shows the live clock, cards and charts to the CEO/COO', async () => {
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-clock-time');
    expect(res.text).toContain('data-tile="requests"');
    expect(res.text).toContain('data-chart="appointments"');
    expect(res.text).toContain('data-chart="signins"');
    expect(res.text).toContain('Show as table');
    expect(res.text).toContain('/js/dashboard.js');
  });

  it('hides charts from roles without "Dashboard analytics"', async () => {
    const agent = await signIn(await makeUser('reception'));
    const res = await agent.get('/portal');
    expect(res.status).toBe(200);
    expect(res.text).toContain('data-tile="requests"');
    expect(res.text).not.toContain('data-chart=');
  });

  it('keeps the embedded data safe inside its script tag', async () => {
    await db('contact_messages').insert({ type: 'message', recipient: 'general', name: '</script><script>alert(1)</script>', email: 'x@example.com', message: 'hi' });
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal');
    const json = res.text.match(/<script type="application\/json" id="dashboard-data">([\s\S]*?)<\/script>/)[1];
    expect(json).not.toContain('<');
    expect(() => JSON.parse(json)).not.toThrow();
  });
});

describe('dashboard data (silent refresh)', () => {
  it('returns current tiles and charts as JSON', async () => {
    await db('appointments').insert({ type_id: typeId, source: 'website', status: 'requested', name: 'A', email: 'a@example.com' });
    const agent = await signIn(await makeUser('admin'));
    const res = await agent.get('/portal/dashboard/data');
    expect(res.status).toBe(200);
    expect(res.headers['cache-control']).toContain('no-store');
    expect(res.body.tiles.find((t) => t.key === 'requests').value).toBe(1);
    expect(res.body.charts.map((c) => c.key)).toEqual(['appointments', 'enquiries', 'sources', 'signins']);
    expect(res.body.office.label).toMatch(/^Office (open|closed)/);

    await db('appointments').insert({ type_id: typeId, source: 'phone', status: 'requested', name: 'B', phone: '410-555-0100' });
    const again = await agent.get('/portal/dashboard/data');
    expect(again.body.tiles.find((t) => t.key === 'requests').value).toBe(2);
  });

  it('counts appointments by week and outcome, and the attendance rate', async () => {
    const lastWeek = addDaysIso(today(), -7);
    const at = marylandDateTime(lastWeek, '10:00');
    await db('appointments').insert([
      { type_id: typeId, source: 'website', status: 'completed', name: 'A', email: 'a@example.com', scheduled_at: at },
      { type_id: typeId, source: 'website', status: 'completed', name: 'B', email: 'b@example.com', scheduled_at: at },
      { type_id: typeId, source: 'phone', status: 'completed', name: 'C', phone: '1', scheduled_at: at },
      { type_id: typeId, source: 'walk_in', status: 'no_show', name: 'D', phone: '1', scheduled_at: at },
    ]);
    const agent = await signIn(await makeUser('admin'));
    const { body } = await agent.get('/portal/dashboard/data');
    const chart = body.charts.find((c) => c.key === 'appointments');
    const completed = chart.series.find((s) => s.key === 'completed');
    expect(completed.values.reduce((a, b) => a + b, 0)).toBe(3);
    expect(chart.totals.reduce((a, b) => a + b, 0)).toBe(4);
    expect(chart.figure.value).toBe('75%');
    const sources = body.charts.find((c) => c.key === 'sources');
    expect(sources.series[0].values).toEqual([2, 1, 1]); // website, walk-in, phone
  });

  it('only includes what the role can already see', async () => {
    // Program Director: charts yes, but no audit log, so no sign-in chart.
    const director = await signIn(await makeUser('program_director'));
    const d = (await director.get('/portal/dashboard/data')).body;
    expect(d.charts.map((c) => c.key)).toEqual(['appointments', 'enquiries', 'sources']);
    expect(d.tiles.map((t) => t.key)).not.toContain('staff');

    // IT: staff accounts only; no client information and no charts.
    const it_ = await signIn(await makeUser('it_admin'));
    const i = (await it_.get('/portal/dashboard/data')).body;
    expect(i.tiles.map((t) => t.key)).toEqual(['staff']);
    expect(i.charts).toEqual([]);

    // Intake (intake-only inbox): enquiries chart would need the analytics permission.
    const intake = await signIn(await makeUser('intake_specialist'));
    expect((await intake.get('/portal/dashboard/data')).body.charts).toEqual([]);
  });

  it('does not keep an idle session alive', async () => {
    const agent = await signIn(await makeUser('admin'));
    const original = config.session.idleMinutes;
    config.session.idleMinutes = 1 / 60; // 1 second
    try {
      await agent.get('/portal'); // real activity
      await new Promise((r) => setTimeout(r, 600));
      expect((await agent.get('/portal/dashboard/data')).status).toBe(200); // background: not activity
      await new Promise((r) => setTimeout(r, 600));
      const res = await agent.get('/portal/dashboard/data');
      expect(res.status).toBe(302);
      expect(res.headers.location).toContain('ended=expired');
    } finally {
      config.session.idleMinutes = original;
    }
  });

  it('sends a form posted after the idle timeout to sign-in, then back', async () => {
    const agent = await signIn(await makeUser('admin'));
    const page = await agent.get('/portal/account');
    const token = csrfFrom(page.text);
    const original = config.session.idleMinutes;
    config.session.idleMinutes = 1 / 600; // 0.1 second
    try {
      await new Promise((r) => setTimeout(r, 300));
      const res = await agent.post('/portal/account/sign-out-others').type('form').set('Referer', 'http://127.0.0.1/portal/account').set('Host', '127.0.0.1').send({ _csrf: token });
      expect(res.status).toBe(303);
      expect(res.headers.location).toBe('/portal/login?ended=expired&next=%2Fportal%2Faccount');
    } finally {
      config.session.idleMinutes = original;
    }
  });

  it('requires sign-in', async () => {
    const res = await request(app).get('/portal/dashboard/data');
    expect(res.status).toBe(302);
    expect(res.headers.location).toContain('/portal/login');
  });
});
