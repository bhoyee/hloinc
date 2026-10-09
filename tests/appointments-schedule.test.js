import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db, nextWeekday } from './helpers.js';

const require = createRequire(import.meta.url);
const bcrypt = require('bcryptjs');
const roles = require('../src/services/roles');
const { DEFAULT_ROLES } = require('../src/auth/permissions');
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
    await db('role_permissions').insert(r.permissions.map((permission) => ({ role_id: row.id, permission })));
  }
  roles.clearCache();
}

async function makeUser(role, name) {
  const [id] = await db('users').insert({
    name: name || `${role} person`,
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

async function post(agent, fromPath, path, body = {}) {
  const page = await agent.get(fromPath);
  return agent.post(path).type('form').send({ ...body, _csrf: csrfFrom(page.text) });
}

let typeId;
async function request_(overrides = {}) {
  const [id] = await db('appointments').insert({
    type_id: typeId,
    source: 'website',
    status: 'requested',
    name: 'Sam Visitor',
    email: 'sam@example.com',
    phone: '410-555-0100',
    requested_date: nextWeekday(3),
    requested_window: 'morning',
    ...overrides,
  });
  return id;
}

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('shifts').del();
  await db('appointments').del();
  await db('password_tokens').del();
  await db('users').del();
  await db('appointment_types').del();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  await resetRoles();
});

afterAll(() => db.destroy());

describe('appointments: access by role', () => {
  it('lets Reception view and log, but not confirm or cancel', async () => {
    const id = await request_();
    const agent = await signIn(await makeUser('reception'));
    expect((await agent.get('/portal/appointments')).status).toBe(200);
    expect((await agent.get('/portal/appointments/calendar')).status).toBe(200);
    expect((await agent.get('/portal/appointments/new')).status).toBe(200);
    const confirm = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date: nextWeekday(3), time: '10:00', duration_minutes: 60 });
    expect(confirm.status).toBe(403);
    expect((await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/cancel`)).status).toBe(403);
  });

  it('keeps appointments away from roles without access', async () => {
    const agent = await signIn(await makeUser('it_admin'));
    expect((await agent.get('/portal/appointments')).status).toBe(403);
  });

  it('lets coordinators and intake specialists cancel (requirements §4)', async () => {
    for (const role of ['program_coordinator', 'intake_specialist', 'program_director']) {
      const id = await request_();
      const agent = await signIn(await makeUser(role));
      await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/cancel`, { reason: 'Visitor asked' });
      expect((await db('appointments').where({ id }).first()).status, role).toBe('cancelled');
    }
  });
});

describe('confirming a website request', () => {
  it('schedules it in Maryland time, records who did it and emails the visitor', async () => {
    const id = await request_();
    const agent = await signIn(await makeUser('program_coordinator', 'Casey Coordinator'));
    const date = nextWeekday(3);
    const res = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, {
      date, time: '10:30', duration_minutes: 60, notify: 'yes',
    });
    expect(res.status).toBe(303);
    const row = await db('appointments').where({ id }).first();
    expect(row.status).toBe('confirmed');
    expect(new Date(row.scheduled_at).getTime()).toBe(marylandDateTime(date, '10:30').getTime());
    expect(marylandParts(row.scheduled_at)).toMatchObject({ date, time: '10:30' });
    expect(await db('audit_log').where({ action: 'appointment.confirm' }).first()).toBeTruthy();
    const page = await agent.get(`/portal/appointments/${id}`);
    expect(page.text).toContain('We emailed sam@example.com');
  });

  it('warns about a full slot and outside office hours, and allows booking anyway', async () => {
    const date = nextWeekday(3);
    await request_({ status: 'confirmed', scheduled_at: marylandDateTime(date, '10:00'), duration_minutes: 60, requested_date: null, requested_window: null });
    const id = await request_();
    const agent = await signIn(await makeUser('program_coordinator'));

    const full = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date, time: '10:30', duration_minutes: 30 });
    expect(full.status).toBe(422);
    expect(full.text).toContain('fully booked');

    const late = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date, time: '18:00', duration_minutes: 30 });
    expect(late.text).toContain('outside office hours');

    const anyway = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date, time: '10:30', duration_minutes: 30, override: 'yes' });
    expect(anyway.status).toBe(303);
    const entry = await db('audit_log').where({ action: 'appointment.confirm' }).first();
    expect(JSON.parse(entry.metadata).bookedAnyway[0]).toContain('fully booked');
  });

  it('allows back-to-back bookings', async () => {
    const date = nextWeekday(3);
    await request_({ status: 'confirmed', scheduled_at: marylandDateTime(date, '10:00'), duration_minutes: 60 });
    const id = await request_();
    const agent = await signIn(await makeUser('program_coordinator'));
    const res = await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date, time: '11:00', duration_minutes: 60 });
    expect(res.status).toBe(303);
  });

  it('notifies the staff member it is assigned to', async () => {
    const id = await request_();
    const assignee = await makeUser('intake_specialist', 'Indira Intake');
    const agent = await signIn(await makeUser('program_coordinator'));
    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date: nextWeekday(3), time: '10:00', duration_minutes: 60, assigned_to: assignee.id });
    const n = await db('notifications').where({ user_id: assignee.id }).first();
    expect(n.title).toContain('You’ve been assigned');
    expect(n.link).toBe(`/portal/appointments/${id}`);
  });
});

describe('appointment status rules', () => {
  it('moves through completed, no-show and reopen, and refuses impossible moves', async () => {
    const id = await request_();
    const agent = await signIn(await makeUser('program_coordinator'));
    // Can't complete something that was never confirmed.
    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/status`, { action: 'complete' });
    expect((await db('appointments').where({ id }).first()).status).toBe('requested');

    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/schedule`, { date: nextWeekday(3), time: '10:00', duration_minutes: 60 });
    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/status`, { action: 'no_show' });
    expect((await db('appointments').where({ id }).first()).status).toBe('no_show');
    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/status`, { action: 'reopen' });
    expect((await db('appointments').where({ id }).first()).status).toBe('confirmed');
    await post(agent, `/portal/appointments/${id}`, `/portal/appointments/${id}/status`, { action: 'complete' });
    expect((await db('appointments').where({ id }).first()).status).toBe('completed');
  });

  it('only lets Admin delete permanently', async () => {
    const id = await request_();
    const director = await signIn(await makeUser('program_director'));
    expect((await post(director, `/portal/appointments/${id}`, `/portal/appointments/${id}/delete`, { confirm: 'yes' })).status).toBe(403);
    const admin = await signIn(await makeUser('admin'));
    await post(admin, `/portal/appointments/${id}`, `/portal/appointments/${id}/delete`, { confirm: 'yes' });
    expect(await db('appointments').where({ id }).first()).toBeUndefined();
    expect(await db('audit_log').where({ action: 'appointment.delete' }).first()).toBeTruthy();
  });
});

describe('logging walk-ins and phone appointments', () => {
  it('lets Reception log a walk-in happening now', async () => {
    const agent = await signIn(await makeUser('reception', 'Riley Reception'));
    const now = marylandParts(new Date());
    // A walk-in can be outside office hours in tests run at night, so tick "book anyway".
    const res = await post(agent, '/portal/appointments/new', '/portal/appointments', {
      source: 'walk_in', type_id: typeId, name: 'Walk In Person', phone: '410-555-0199', email: '',
      date: now.date, time: now.time, duration_minutes: 30, override: 'yes',
    });
    expect(res.status).toBe(303);
    const row = await db('appointments').where({ name: 'Walk In Person' }).first();
    expect(row).toMatchObject({ source: 'walk_in', status: 'confirmed' });
    expect(await db('audit_log').where({ action: 'appointment.log' }).first()).toBeTruthy();
  });

  it('needs an email address to send a confirmation', async () => {
    const agent = await signIn(await makeUser('reception'));
    const res = await post(agent, '/portal/appointments/new', '/portal/appointments', {
      source: 'phone', type_id: typeId, name: 'Phone Person', phone: '410-555-0199', email: '',
      date: nextWeekday(3), time: '10:00', duration_minutes: 30, notify: 'yes',
    });
    expect(res.status).toBe(422);
    expect(res.text).toContain('Add an email address');
  });
});

describe('privacy', () => {
  it('records who opened an appointment, once per half hour', async () => {
    const id = await request_();
    const agent = await signIn(await makeUser('reception'));
    await agent.get(`/portal/appointments/${id}`);
    await agent.get(`/portal/appointments/${id}`);
    const views = await db('audit_log').where({ action: 'appointment.view', entity_id: String(id) });
    expect(views).toHaveLength(1);
  });

  it('makes appointments searchable only for roles that can see them', async () => {
    await request_({ name: 'Findable Visitor' });
    const allowed = await signIn(await makeUser('reception'));
    const found = await allowed.get('/portal/search?format=json&q=findable');
    expect(found.body.groups.find((g) => g.label === 'Appointments').items[0].title).toBe('Findable Visitor');
    const it = await signIn(await makeUser('it_admin'));
    const hidden = await it.get('/portal/search?format=json&q=findable');
    expect(hidden.body.groups.find((g) => g.label === 'Appointments')).toBeUndefined();
  });
});

describe('calendar', () => {
  it('shows booked appointments in week and month views', async () => {
    const date = nextWeekday(3);
    await request_({ name: 'Calendar Person', status: 'confirmed', scheduled_at: marylandDateTime(date, '14:00'), duration_minutes: 60 });
    const agent = await signIn(await makeUser('reception'));
    const week = await agent.get(`/portal/appointments/calendar?view=week&date=${date}`);
    expect(week.text).toContain('Calendar Person');
    expect(week.text).toContain('2 p.m.');
    const month = await agent.get(`/portal/appointments/calendar?view=month&date=${date}`);
    expect(month.text).toContain('Calendar Person');
  });

  it('lists requests waiting to be scheduled', async () => {
    await request_({ name: 'Waiting Person' });
    const agent = await signIn(await makeUser('reception'));
    expect((await agent.get('/portal/appointments/calendar')).text).toContain('Waiting Person');
  });
});

describe('appointment types', () => {
  it('lets directors manage types, and hides inactive ones from the website', async () => {
    const agent = await signIn(await makeUser('program_director'));
    await post(agent, '/portal/appointments/types/new', '/portal/appointments/types', { name: 'Family meeting', duration_minutes: 45, capacity: 2, active: 'yes' });
    const t = await db('appointment_types').where({ name: 'Family meeting' }).first();
    expect(t).toMatchObject({ duration_minutes: 45, capacity: 2, active: 1 });
    expect((await request(app).get('/appointments/request')).text).toContain('Family meeting');

    await post(agent, `/portal/appointments/types/${t.id}`, `/portal/appointments/types/${t.id}`, { name: 'Family meeting', duration_minutes: 45, capacity: 2 });
    expect((await request(app).get('/appointments/request')).text).not.toContain('Family meeting');
  });

  it('won’t delete a type that has appointments', async () => {
    await request_();
    const agent = await signIn(await makeUser('admin'));
    await post(agent, `/portal/appointments/types/${typeId}`, `/portal/appointments/types/${typeId}/delete`);
    expect(await db('appointment_types').where({ id: typeId }).first()).toBeTruthy();
  });

  it('is off-limits to roles without the permission', async () => {
    const agent = await signIn(await makeUser('program_coordinator'));
    expect((await agent.get('/portal/appointments/types')).status).toBe(403);
  });
});

describe('staff schedule', () => {
  it('lets managers add shifts, and tells the staff member', async () => {
    const reception = await makeUser('reception', 'Riley Reception');
    const agent = await signIn(await makeUser('program_coordinator'));
    const date = nextWeekday(3);
    await post(agent, '/portal/schedule/new', '/portal/schedule', {
      user_id: reception.id, kind: 'shift', date, start_time: '09:00', end_time: '17:00', label: 'Front desk',
    });
    const s = await db('shifts').where({ user_id: reception.id }).first();
    expect(new Date(s.start_at).getTime()).toBe(marylandDateTime(date, '09:00').getTime());
    const n = await db('notifications').where({ user_id: reception.id }).first();
    expect(n.title).toContain('New on your schedule');

    const own = await signIn(reception);
    const mine = await own.get(`/portal/schedule?view=mine&week=${date}`);
    expect(mine.text).toContain('Front desk');
  });

  it('handles overnight shifts as ending the next day', async () => {
    const dsp = await makeUser('reception');
    const agent = await signIn(await makeUser('program_director'));
    const date = nextWeekday(3);
    await post(agent, '/portal/schedule/new', '/portal/schedule', { user_id: dsp.id, kind: 'shift', date, start_time: '22:00', end_time: '08:00' });
    const s = await db('shifts').where({ user_id: dsp.id }).first();
    expect(new Date(s.end_at).getTime()).toBe(marylandDateTime(addDaysIso(date, 1), '08:00').getTime());
  });

  it('refuses clashing entries and skips clashing weeks when repeating', async () => {
    const person = await makeUser('reception');
    const agent = await signIn(await makeUser('program_coordinator'));
    const date = nextWeekday(3);
    await post(agent, '/portal/schedule/new', '/portal/schedule', { user_id: person.id, kind: 'time_off', date: addDaysIso(date, 7), all_day: 'yes', label: 'Annual leave' });
    const clash = await post(agent, '/portal/schedule/new', '/portal/schedule', { user_id: person.id, kind: 'shift', date: addDaysIso(date, 7), start_time: '09:00', end_time: '17:00' });
    expect(clash.status).toBe(422);

    await post(agent, '/portal/schedule/new', '/portal/schedule', { user_id: person.id, kind: 'shift', date, start_time: '09:00', end_time: '17:00', repeat_weeks: 3 });
    // Week 2 clashes with the leave, so 2 of 3 weeks are added (plus the leave itself).
    expect(await db('shifts').where({ user_id: person.id, kind: 'shift' }).count({ n: '*' }).first()).toEqual({ n: 2 });
  });

  it('shows Intake their own schedule only, and lets nobody without permission edit', async () => {
    const agent = await signIn(await makeUser('intake_specialist'));
    const page = await agent.get('/portal/schedule');
    expect(page.status).toBe(200);
    expect(page.text).toContain('My schedule');
    expect(page.text).not.toContain('aria-label="Team schedule"');
    expect((await agent.get('/portal/schedule/new')).status).toBe(403);

    // Reception sees only their own too (Roles & permissions → Staff schedule).
    const reception = await signIn(await makeUser('reception'));
    expect((await reception.get('/portal/schedule')).text).not.toContain('aria-label="Team schedule"');
    expect((await reception.get('/portal/schedule/new')).status).toBe(403);
  });
});
