import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const workday = require('../src/services/workday');
const roles = require('../src/services/roles');
const { marylandDateTime, marylandParts } = require('../src/lib/hours');

const app = createApp();
const DAY = 24 * 60 * 60 * 1000;

let typeId;
beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('message_reads').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('appointments').del();
  await db('shifts').del();
  await db('users').del();
  await db('appointment_types').del();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  await resetRoles();
});

afterAll(() => db.destroy());

/** A staff member as the portal sees them once signed in (permissions and schedule scope attached). */
async function staff(role) {
  const user = await makeUser(role);
  const r = await roles.get(role);
  return { ...user, status: 'active', permissions: r.permissions, scheduleScope: r.scheduleScope };
}

const message = (over = {}) =>
  db('contact_messages').insert({ type: 'message', recipient: 'general', name: 'Pat Visitor', email: 'pat@example.com', message: 'Hello', email_status: 'sent', ...over });

describe('business days', () => {
  it('skips weekends when working out how long something has waited', () => {
    // Monday 10:00 Maryland time, two business days back is the previous Thursday 10:00.
    const monday = marylandDateTime('2026-10-12', '10:00');
    expect(workday.businessDaysBefore(monday, 2).getTime()).toBe(marylandDateTime('2026-10-08', '10:00').getTime());
  });
});

describe('needs attention', () => {
  it('lists overdue referrals, unassigned items, failed emails and old appointment requests', async () => {
    const admin = await staff('admin');
    const old = new Date(Date.now() - 10 * DAY);
    await message({ type: 'referral', recipient: 'intake', created_at: old });
    await message({ email_status: 'failed' });
    await db('appointments').insert({ type_id: typeId, source: 'website', status: 'requested', name: 'A', email: 'a@example.com', created_at: old });

    const keys = (await workday.attention(admin)).map((i) => i.key);
    expect(keys).toEqual(expect.arrayContaining(['old-referrals', 'unassigned', 'failed-email', 'old-appointments']));
    expect(keys).not.toContain('old-messages'); // the general message is new today
  });

  it('says all caught up when nothing is waiting', async () => {
    const agent = await signIn(app, await makeUser('admin'));
    const page = await agent.get('/portal');
    expect(page.text).toContain('Needs attention');
    expect(page.text).toContain('All caught up');
  });

  it('only counts what the person may see', async () => {
    const intake = await staff('intake_specialist');
    await message({ created_at: new Date(Date.now() - 10 * DAY) }); // general inbox, not intake
    expect((await workday.attention(intake)).map((i) => i.key)).not.toContain('old-messages');
  });
});

describe('today at HLO', () => {
  it('shows today’s appointments and who is working', async () => {
    const admin = await makeUser('admin');
    const today = marylandParts(new Date()).date;
    await db('appointments').insert({ type_id: typeId, source: 'phone', status: 'confirmed', name: 'Alex Sample', scheduled_at: marylandDateTime(today, '23:30'), duration_minutes: 30 });
    await db('shifts').insert({ user_id: admin.id, kind: 'shift', start_at: marylandDateTime(today, '00:00'), end_at: marylandDateTime(today, '23:59') });

    const agent = await signIn(app, admin);
    const page = await agent.get('/portal');
    expect(page.text).toContain('Today at HLO');
    expect(page.text).toContain('Alex Sample');
    expect(page.text).toContain('Working today');
    expect(page.text).toContain(admin.name);
  });

  it('only shows the schedules the person may see', async () => {
    const reception = await staff('reception');
    const director = await makeUser('program_director');
    const today = marylandParts(new Date()).date;
    await db('shifts').insert({ user_id: director.id, kind: 'shift', start_at: marylandDateTime(today, '00:00'), end_at: marylandDateTime(today, '23:59') });
    const view = await workday.today(reception);
    expect(view.working.map((p) => p.name)).not.toContain(director.name);
  });
});

describe('quick actions and live refresh', () => {
  it('offers only the shortcuts the role can use', async () => {
    const adminPage = await (await signIn(app, await makeUser('admin'))).get('/portal');
    for (const label of ['Log a walk-in or call', 'Post an announcement', 'Add a job', 'Invite a staff member']) expect(adminPage.text).toContain(label);


    const page = await (await signIn(app, await makeUser('reception'))).get('/portal');
    expect(page.text).toContain('Log a walk-in or call');
    expect(page.text).not.toContain('Invite a staff member');
    expect(page.text).not.toContain('Add a job');
  });

  it('serves the panels on their own and flags changes in the live data', async () => {
    const agent = await signIn(app, await makeUser('admin'));
    const before = (await agent.get('/portal/dashboard/data').set('Accept', 'application/json')).body.sections;
    await message({ email_status: 'failed' });
    const after = (await agent.get('/portal/dashboard/data').set('Accept', 'application/json')).body.sections;
    expect(after).not.toBe(before);
    const panels = await agent.get('/portal/dashboard/panels');
    expect(panels.status).toBe(200);
    expect(panels.text).toContain('did not send');
    expect(panels.text).not.toContain('<html');
  });

  it('links from the dashboard to the matching inbox filter', async () => {
    const agent = await signIn(app, await makeUser('admin'));
    await message({ name: 'Nobody Assigned' });
    const page = await agent.get('/portal/messages?tab=all&unassigned=1');
    expect(page.text).toContain('Open items with nobody assigned');
    expect(page.text).toContain('Nobody Assigned');
  });
});
