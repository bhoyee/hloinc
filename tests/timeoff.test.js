import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const requireRoles = () => require('../src/services/roles');

const require = createRequire(import.meta.url);
const { marylandParts, addDaysIso } = require('../src/lib/hours');
const { _outbox: outbox } = require('../src/services/notify');

const app = createApp();
const day = (n) => addDaysIso(marylandParts(new Date()).date, n);

beforeEach(async () => {
  outbox.length = 0;
  await db('time_off_requests').del();
  await db('notifications').del();
  await db('audit_log').del();
  await db('shifts').del();
  await db('users').del();
  await resetRoles();
});

/** Give a role the "Receive & approve time-off requests" permission (as the Admin would). */
async function allowApprovals(roleKey) {
  const role = await db('roles').where({ key: roleKey }).first();
  await db('role_permissions').insert({ role_id: role.id, permission: 'schedule.approve_time_off' });
  requireRoles().clearCache();
}

afterAll(() => db.destroy());

const ask = (agent, over = {}) => post(agent, '/portal/schedule/time-off/new', '/portal/schedule/time-off', {
  reason: 'vacation', start_date: day(5), end_date: day(7), all_day: 'yes', start_time: '', end_time: '', notes: 'Family trip', ...over,
});

describe('time-off requests', () => {
  it('lets any staff member ask, and tells only the Admin by default (in the app and by email)', async () => {
    const admin = await makeUser('admin', 'Avery Admin');
    await makeUser('program_director', 'Dana Director');
    await makeUser('program_coordinator', 'Casey Coordinator');
    const reception = await makeUser('reception', 'Riley Reception');
    const agent = await signIn(app, reception);

    const res = await ask(agent);
    expect(res.status).toBe(303);
    const [r] = await db('time_off_requests');
    expect(r).toMatchObject({ user_id: reception.id, reason: 'vacation', status: 'pending' });
    expect(Boolean(r.all_day)).toBe(true);

    expect(await db('notifications').where({ type: 'timeoff' }).pluck('user_id')).toEqual([admin.id]);
    expect(outbox.map((m) => m.to)).toEqual([admin.email]);
    expect(outbox[0].subject).toMatch(/^Time-off request from Riley Reception: .* \(3 days\)$/);
    expect(outbox[0].html).toContain('Review the request');
  });

  it('also tells roles the Admin has given the permission to', async () => {
    const admin = await makeUser('admin', 'Avery Admin');
    const director = await makeUser('program_director', 'Dana Director');
    await makeUser('program_coordinator', 'Casey Coordinator');
    await allowApprovals('program_director');
    await ask(await signIn(app, await makeUser('reception', 'Riley Reception')));
    expect((await db('notifications').where({ type: 'timeoff' }).pluck('user_id')).sort()).toEqual([admin.id, director.id].sort());
    // The Program Director can now decide; a coordinator still can't.
    const [r] = await db('time_off_requests');
    const page = (await (await signIn(app, director)).get(`/portal/schedule/time-off/${r.id}`)).text;
    expect(page).toContain('Approve or decline');
  });

  it('checks the dates', async () => {
    const agent = await signIn(app, await makeUser('reception'));
    expect((await ask(agent, { start_date: day(-1) })).status).toBe(422);
    expect((await ask(agent, { end_date: day(2) })).status).toBe(422); // before the first day
    expect((await ask(agent, { all_day: '', start_time: '15:00', end_time: '10:00' })).status).toBe(422);
    expect((await ask(agent, { all_day: '', start_time: '09:00', end_time: '12:00' })).status).toBe(303);
    expect(await db('time_off_requests')).toHaveLength(1);
  });

  it('approves: adds the time off to the schedule and tells the person', async () => {
    const admin = await makeUser('admin', 'Avery Admin');
    const coordinator = await makeUser('program_coordinator', 'Casey Coordinator');
    const reception = await makeUser('reception', 'Riley Reception');
    await ask(await signIn(app, reception));
    const [r] = await db('time_off_requests');
    outbox.length = 0;

    // Without the permission, a coordinator can't decide.
    await post(await signIn(app, coordinator), `/portal/schedule/time-off/${r.id}`, `/portal/schedule/time-off/${r.id}/approve`);
    expect((await db('time_off_requests').where({ id: r.id }).first()).status).toBe('pending');

    const manager = await signIn(app, admin);
    await post(manager, `/portal/schedule/time-off/${r.id}`, `/portal/schedule/time-off/${r.id}/approve`, { note: 'Enjoy!' });
    const after = await db('time_off_requests').where({ id: r.id }).first();
    expect(after).toMatchObject({ status: 'approved', decided_by: admin.id, decision_note: 'Enjoy!' });
    const shift = await db('shifts').where({ id: after.shift_id }).first();
    expect(shift).toMatchObject({ user_id: reception.id, kind: 'time_off', label: 'Vacation / annual leave' });

    expect(await db('notifications').where({ user_id: reception.id, title: 'Your time off was approved' })).toHaveLength(1);
    expect(outbox).toHaveLength(1);
    expect(outbox[0]).toMatchObject({ to: reception.email });
    expect(outbox[0].text).toContain('Note: Enjoy!');
  });

  it('declines with a reason, and only once', async () => {
    const admin = await makeUser('admin');
    const reception = await makeUser('reception', 'Riley Reception');
    await ask(await signIn(app, reception));
    const [r] = await db('time_off_requests');
    const agent = await signIn(app, admin);
    await post(agent, `/portal/schedule/time-off/${r.id}`, `/portal/schedule/time-off/${r.id}/decline`, { note: 'Short on cover that week.' });
    expect(await db('time_off_requests').where({ id: r.id }).first()).toMatchObject({ status: 'declined', decision_note: 'Short on cover that week.' });
    expect(await db('notifications').where({ user_id: reception.id, title: 'Your time-off request was declined' })).toHaveLength(1);
    await post(agent, `/portal/schedule/time-off/${r.id}`, `/portal/schedule/time-off/${r.id}/approve`);
    expect((await db('time_off_requests').where({ id: r.id }).first()).status).toBe('declined');
    expect(await db('shifts')).toHaveLength(0);
  });

  it('stops people deciding their own or others outside their team, and lets the requester cancel', async () => {
    await makeUser('admin');
    await allowApprovals('program_coordinator');
    const coordinator = await makeUser('program_coordinator');
    const reception = await makeUser('reception');
    const coordAgent = await signIn(app, coordinator);
    await ask(coordAgent);
    const [own] = await db('time_off_requests');
    // A coordinator can't approve their own request.
    await post(coordAgent, `/portal/schedule/time-off/${own.id}`, `/portal/schedule/time-off/${own.id}/approve`);
    expect((await db('time_off_requests').where({ id: own.id }).first()).status).toBe('pending');
    // Reception can't see someone else's request at all.
    const recAgent = await signIn(app, reception);
    expect((await recAgent.get(`/portal/schedule/time-off/${own.id}`)).status).toBe(404);
    // The requester cancels.
    await post(coordAgent, `/portal/schedule/time-off/${own.id}`, `/portal/schedule/time-off/${own.id}/cancel`);
    expect((await db('time_off_requests').where({ id: own.id }).first()).status).toBe('cancelled');
  });

  it('shows counters on the tabs, the menu and the dashboard for managers', async () => {
    const admin = await makeUser('admin');
    const reception = await makeUser('reception');
    await ask(await signIn(app, reception));
    const agent = await signIn(app, admin);
    const list = (await agent.get('/portal/schedule/time-off')).text;
    expect(list).toMatch(/Pending\s*<span[^>]*>1<\/span>/);
    expect(list).toMatch(/data-nav-badge="timeOff"[^>]*>1</);
    expect((await agent.get('/portal')).text).toContain('1 time-off request waiting for a decision');
    // Staff without schedule management see only their own requests.
    const mine = (await (await signIn(app, reception)).get('/portal/schedule/time-off')).text;
    expect(mine).toContain('My requests');
    expect(mine).not.toContain('href="/portal/schedule/time-off?tab=pending"');
  });
});

describe('schedule page', () => {
  it('finds staff by name or role on the team view, and has the new buttons', async () => {
    await makeUser('intake_specialist', 'Indira Intake');
    await makeUser('reception', 'Riley Reception');
    const agent = await signIn(app, await makeUser('admin'));
    const page = (await agent.get('/portal/schedule?view=team&q=intake')).text;
    expect(page).toContain('Indira Intake');
    expect(page).not.toContain('Riley Reception');
    expect(page).toContain('1 person</span> matching “intake”');
    expect(page).toContain('Request time off');
    expect(page).toContain('aria-label="Team schedule (scrolls)"');
    expect(page).toMatch(/week=\d{4}-\d{2}-\d{2}&(amp;)?q=intake" data-page-link/);
  });
});
