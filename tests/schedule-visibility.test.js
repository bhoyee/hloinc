import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const { marylandDateTime, marylandParts, weekStartIso, addDaysIso } = require('../src/lib/hours');

const app = createApp();
const monday = () => weekStartIso(marylandParts(new Date()).date);

let people;
let shiftIds;

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('shifts').del();
  await db('users').del();
  await resetRoles();
  people = {
    ceo: await makeUser('admin', 'Cara CEO'),
    director: await makeUser('program_director', 'Dana Director'),
    coordinator: await makeUser('program_coordinator', 'Cole Coordinator'),
    intake: await makeUser('intake_specialist', 'Ivy Intake'),
    reception: await makeUser('reception', 'Rae Reception'),
    it: await makeUser('it_admin', 'Ian IT'),
  };
  shiftIds = {};
  for (const [k, u] of Object.entries(people)) {
    const [id] = await db('shifts').insert({ user_id: u.id, kind: 'shift', start_at: marylandDateTime(monday(), '09:00'), end_at: marylandDateTime(monday(), '17:00'), label: `${k} shift` });
    shiftIds[k] = id;
  }
});

afterAll(() => db.destroy());

const names = (html) => Object.values(people).map((u) => u.name).filter((n) => html.includes(n));

describe('who sees whose schedule', () => {
  it('the CEO/COO sees everyone', async () => {
    const agent = await signIn(app, people.ceo);
    const html = (await agent.get(`/portal/schedule?week=${monday()}`)).text;
    expect(names(html).sort()).toEqual(Object.values(people).map((u) => u.name).sort());
  });

  it('a Program Director sees their team but not the CEO/COO', async () => {
    const agent = await signIn(app, people.director);
    const html = (await agent.get(`/portal/schedule?week=${monday()}`)).text;
    expect(names(html).sort()).toEqual(['Cole Coordinator', 'Dana Director', 'Ivy Intake', 'Rae Reception']);
    // Can't open or change the CEO's shift.
    expect((await agent.get(`/portal/schedule/${shiftIds.ceo}`)).status).toBe(404);
    expect((await agent.get(`/portal/schedule/${shiftIds.coordinator}`)).status).toBe(200);
  });

  it('a Program Coordinator sees intake and reception, not the director or CEO', async () => {
    const agent = await signIn(app, people.coordinator);
    const html = (await agent.get(`/portal/schedule?week=${monday()}`)).text;
    expect(names(html).sort()).toEqual(['Cole Coordinator', 'Ivy Intake', 'Rae Reception']);
    const form = (await agent.get('/portal/schedule/new')).text;
    expect(form).not.toContain('Dana Director');
    // Can't add a shift for someone outside their view.
    const res = await post(agent, '/portal/schedule/new', '/portal/schedule', { user_id: people.director.id, kind: 'shift', date: addDaysIso(monday(), 1), start_time: '09:00', end_time: '12:00', repeat_weeks: 1 });
    expect(res.status).toBe(422);
    expect(await db('shifts').where({ user_id: people.director.id }).count({ n: '*' }).first()).toEqual({ n: 1 });
  });

  it('Reception, Intake and IT see only their own', async () => {
    for (const k of ['reception', 'intake', 'it']) {
      const agent = await signIn(app, people[k]);
      const res = await agent.get(`/portal/schedule?week=${monday()}&view=team`);
      expect(res.status).toBe(200);
      expect(names(res.text)).toEqual([people[k].name]);
    }
  });

  it('the CEO/COO can change who sees what in Roles & permissions', async () => {
    const ceo = await signIn(app, people.ceo);
    const role = (await ceo.get('/portal/roles/reception')).text;
    expect(role).toContain('Whose shifts and time off');
    const perms = [...role.matchAll(/name="permissions" value="([a-z_.]+)"[^>]*checked/g)].map((m) => m[1]);
    const res = await post(ceo, '/portal/roles/reception', '/portal/roles/reception', {
      name: 'Reception', description: '', permissions: perms, schedule_mode: 'roles', schedule_roles: ['intake_specialist'],
    });
    expect(res.status).toBe(303);
    const front = await signIn(app, people.reception);
    const html = (await front.get(`/portal/schedule?week=${monday()}`)).text;
    expect(names(html).sort()).toEqual(['Ivy Intake', 'Rae Reception']);
  });
});
