import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import request from 'supertest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const { marylandParts, addDaysIso } = require('../src/lib/hours');

const app = createApp();
const today = () => marylandParts(new Date()).date;

const POST = (over = {}) => ({
  title: 'Office closed Monday',
  body: 'Our office is closed for the holiday. We reopen on Tuesday at 9 a.m.',
  audience: 'public',
  start_date: addDaysIso(today(), -1),
  start_time: '08:00',
  end_date: '',
  end_time: '',
  link_url: '',
  link_label: '',
  ...over,
});

/** Give a role announcement permissions, as the Admin would under Roles & permissions. */
async function grant(roleKey, permissions) {
  const role = await db('roles').where({ key: roleKey }).first();
  for (const permission of permissions) await db('role_permissions').insert({ role_id: role.id, permission }).onConflict().ignore();
  require('../src/services/roles').clearCache();
}

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('announcements').del();
  await db('users').del();
  await resetRoles();
  // Most tests post as a Program Coordinator whose role the Admin has allowed to manage announcements.
  await grant('program_coordinator', ['announcements.edit', 'announcements.archive', 'announcements.pause', 'announcements.end']);
});

describe('announcements: who may manage them', () => {
  it('lets only Admin manage announcements by default; everyone else can only view', async () => {
    await resetRoles();
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/announcements/new', '/portal/announcements', POST({ audience: 'internal' }));
    const { id } = await db('announcements').first();
    for (const role of ['program_director', 'program_coordinator', 'intake_specialist', 'reception']) {
      const agent = await signIn(app, await makeUser(role));
      expect((await agent.get('/portal/announcements/new')).status, role).toBe(403);
      expect((await post(agent, '/portal', `/portal/announcements/${id}/pause`, { action: 'pause' })).status, role).toBe(403);
      expect((await post(agent, '/portal', `/portal/announcements/${id}/end`)).status, role).toBe(403);
      const board = (await agent.get('/portal')).text;
      expect(board, role).toContain('Office closed Monday'); // still sees it
      expect(board, role).not.toContain(`/portal/announcements/${id}/pause`);
    }
    expect((await db('announcements').first()).paused_at).toBeNull();
  }, 15000);

  it('lets the Admin give each part separately (e.g. pause only)', async () => {
    await resetRoles();
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/announcements/new', '/portal/announcements', POST({ audience: 'internal' }));
    const { id } = await db('announcements').first();
    await grant('program_director', ['announcements.pause']);
    const director = await signIn(app, await makeUser('program_director'));
    expect((await director.get('/portal/announcements/new')).status).toBe(403);
    expect((await post(director, '/portal', `/portal/announcements/${id}/end`)).status).toBe(403);
    await post(director, '/portal', `/portal/announcements/${id}/pause`, { action: 'pause' });
    expect((await db('announcements').first()).paused_at).toBeTruthy();
    const board = (await director.get('/portal')).text;
    expect(board).toContain(`action="/portal/announcements/${id}/pause"`);
    expect(board).not.toContain(`action="/portal/announcements/${id}/end"`);
  });
});

afterAll(() => db.destroy());

describe('announcements: where they appear', () => {
  it('shows a website announcement on the home page', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const res = await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ link_url: '/contact', link_label: 'Contact us' }));
    expect(res.status).toBe(303);
    const home = await request(app).get('/');
    expect(home.text).toContain('Office closed Monday');
    expect(home.text).toContain('href="/contact"');
    expect(await db('audit_log').where({ action: 'announcement.create' }).first()).toBeTruthy();
  });

  it('puts staff-only announcements on the staff board and notifies staff', async () => {
    const coordinator = await makeUser('program_coordinator');
    const reception = await makeUser('reception');
    const agent = await signIn(app, coordinator);
    await post(agent, '/portal/announcements/new', '/portal/announcements', POST({ title: 'Team meeting Friday', audience: 'internal' }));

    expect((await request(app).get('/')).text).not.toContain('Team meeting Friday');
    const front = await signIn(app, reception);
    const dash = await front.get('/portal');
    expect(dash.text).toContain('Team meeting Friday');
    // Reception can read the board but not manage announcements.
    expect((await front.get('/portal/announcements')).status).toBe(403);

    // Normal priority: a banner across the portal, but no bell alert.
    expect(dash.text).toContain('aria-label="Staff announcement"');
    expect(await db('notifications').where({ type: 'announcement' }).first()).toBeUndefined();
  });

  it('alerts all staff (once) for an important staff announcement, and shows it in red', async () => {
    const coordinator = await makeUser('program_coordinator');
    const reception = await makeUser('reception');
    const agent = await signIn(app, coordinator);
    await post(agent, '/portal/announcements/new', '/portal/announcements', POST({ title: 'Office closed today', audience: 'both', priority: 'important' }));
    const n = await db('notifications').where({ user_id: reception.id, type: 'announcement' }).first();
    expect(n).toMatchObject({ title: 'Important: Office closed today' });
    expect(await db('notifications').where({ user_id: coordinator.id }).first()).toBeUndefined(); // not the author
    const [a] = await db('announcements');
    await post(agent, `/portal/announcements/${a.id}`, `/portal/announcements/${a.id}`, POST({ title: 'Office closed today', audience: 'both', priority: 'important', body: 'Updated: we reopen tomorrow at 9.' }));
    expect(await db('notifications').where({ user_id: reception.id, type: 'announcement' })).toHaveLength(1); // still once

    const page = (await (await signIn(app, reception)).get('/portal/messages')).text;
    expect(page).toMatch(/bg-accent-700 text-white" role="region" aria-label="Staff announcement"/);
    expect(page).toContain('Important</span>');
    expect(page).not.toContain(`/portal/banner/${a.id}/dismiss`); // can't be closed
  });

  it('alerts staff when a scheduled important announcement goes live', async () => {
    const reception = await makeUser('reception');
    const agent = await signIn(app, await makeUser('program_coordinator'));
    await post(agent, '/portal/announcements/new', '/portal/announcements', POST({ title: 'Later', audience: 'internal', priority: 'important', start_date: addDaysIso(today(), 1) }));
    expect(await db('notifications').where({ type: 'announcement' }).first()).toBeUndefined();
    await db('announcements').update({ starts_at: new Date(Date.now() - 60000) });
    const ann = require('../src/services/announcements');
    expect(await ann.notifyImportant()).toBe(1);
    expect(await db('notifications').where({ user_id: reception.id, type: 'announcement' }).first()).toBeTruthy();
    expect(await ann.notifyImportant()).toBe(0);
  });

  it('lets each person close a normal banner; editing it brings it back; "+N more" for the rest', async () => {
    const coordinator = await makeUser('program_coordinator');
    const reception = await makeUser('reception');
    const agent = await signIn(app, coordinator);
    await post(agent, '/portal/announcements/new', '/portal/announcements', POST({ title: 'Older news', audience: 'internal', start_date: addDaysIso(today(), -2) }));
    await post(agent, '/portal/announcements/new', '/portal/announcements', POST({ title: 'Team lunch Friday', audience: 'internal' }));
    const front = await signIn(app, reception);
    let page = (await front.get('/portal/schedule')).text;
    expect(page).toContain('Team lunch Friday');
    expect(page).toContain('+1 more announcement');

    const lunch = await db('announcements').where({ title: 'Team lunch Friday' }).first();
    await post(front, '/portal/schedule', `/portal/banner/${lunch.id}/dismiss`, { back: '/portal/schedule' });
    page = (await front.get('/portal/schedule')).text;
    expect(page).not.toMatch(/<strong class="font-semibold">Team lunch Friday/);
    expect(page).toMatch(/<strong class="font-semibold">Older news/);

    await new Promise((r) => setTimeout(r, 1100)); // so the edit has a new timestamp (to the second)
    await post(agent, `/portal/announcements/${lunch.id}`, `/portal/announcements/${lunch.id}`, POST({ title: 'Team lunch Friday', audience: 'internal', body: 'Now at 1 p.m. in the big room.' }));
    page = (await front.get('/portal/schedule')).text;
    expect(page).toMatch(/<strong class="font-semibold">Team lunch Friday/);
  });

  it('respects start and end dates', async () => {
    const now = Date.now();
    await db('announcements').insert([
      { title: 'Future news', body: 'Not yet', audience: 'both', starts_at: new Date(now + 86400000) },
      { title: 'Old news', body: 'Gone', audience: 'both', starts_at: new Date(now - 3 * 86400000), ends_at: new Date(now - 86400000) },
      { title: 'Current news', body: 'Now', audience: 'both', starts_at: new Date(now - 86400000), ends_at: new Date(now + 86400000) },
      { title: 'Archived news', body: 'Hidden', audience: 'both', starts_at: new Date(now - 86400000), archived_at: new Date() },
    ]);
    const home = (await request(app).get('/')).text;
    expect(home).toContain('Current news');
    expect(home).not.toContain('Future news');
    expect(home).not.toContain('Old news');
    expect(home).not.toContain('Archived news');

    const director = await signIn(app, await makeUser('program_director'));
    const scheduled = await director.get('/portal/announcements?tab=scheduled');
    expect(scheduled.text).toContain('Future news');
    // (Current news is in the staff banner at the top, but not in the Scheduled list.)
    const current = await db('announcements').where({ title: 'Current news' }).first();
    expect(scheduled.text).not.toContain(`href="/portal/announcements/${current.id}"`);
  });
});

describe('announcements: checks', () => {
  it('rejects an end before the start, and unsafe links', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const backwards = await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ start_date: today(), end_date: addDaysIso(today(), -2) }));
    expect(backwards.status).toBe(422);
    expect(backwards.text).toContain('The end must be after the start.');
    for (const link_url of ['javascript:alert(1)', 'http://example.com', '//evil.com']) {
      expect((await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ link_url }))).status).toBe(422);
    }
    expect(Number((await db('announcements').count({ n: '*' }).first()).n)).toBe(0);
  });

  it('treats a blank end time as the end of that day (Maryland time)', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const end = addDaysIso(today(), 3);
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ end_date: end }));
    const a = await db('announcements').first();
    const parts = marylandParts(new Date(a.ends_at));
    expect(parts.date).toBe(end);
    expect(parts.time).toBe('23:59');
  });
});

describe('announcements: pause, end and delete', () => {
  it('pauses and resumes: hidden everywhere while paused, dates unchanged', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ audience: 'both' }));
    const before = await db('announcements').first();
    expect((await request(app).get('/')).text).toContain('Office closed Monday');

    await post(coordinator, `/portal/announcements/${before.id}`, `/portal/announcements/${before.id}/pause`, { action: 'pause' });
    expect((await request(app).get('/')).text).not.toContain('Office closed Monday');
    const paused = await db('announcements').first();
    expect(paused.paused_at).toBeTruthy();
    expect(paused.starts_at).toEqual(before.starts_at);
    const page = (await coordinator.get(`/portal/announcements/${before.id}`)).text;
    expect(page).toContain('Resume');
    expect(page).not.toMatch(/>\s*(<svg[^>]*>.*?<\/svg>)?\s*Pause<\/button>/s);
    // Editors still see it on the staff board, marked Paused, so it can be resumed there.
    expect((await coordinator.get('/portal')).text).toMatch(/Paused[\s\S]*Office closed Monday|Office closed Monday[\s\S]*Paused/);

    await post(coordinator, `/portal/announcements/${before.id}`, `/portal/announcements/${before.id}/pause`, { action: 'resume', back: '/portal#staff-board' });
    expect((await db('announcements').first()).paused_at).toBeNull();
    expect((await request(app).get('/')).text).toContain('Office closed Monday');
  });

  it('hides paused posts from people who cannot edit', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ audience: 'internal', title: 'Quiet post' }));
    const { id } = await db('announcements').first();
    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/pause`, { action: 'pause' });
    const reception = await signIn(app, await makeUser('reception'));
    expect((await reception.get('/portal')).text).not.toContain('Quiet post');
  });

  it('lets staff delete only their own posts; only an Admin restores or deletes permanently', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const other = await signIn(app, await makeUser('program_coordinator', 'Other Coordinator'));
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST());
    const { id } = await db('announcements').first();

    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/end`);
    expect((await request(app).get('/')).text).not.toContain('Office closed Monday');

    // Someone else's post: not allowed.
    await post(other, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'delete' });
    expect((await db('announcements').first()).archived_at).toBeNull();

    // Their own: moved to Deleted, and they can't bring it back.
    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'delete' });
    expect((await db('announcements').first()).archived_at).toBeTruthy();
    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'restore' });
    expect((await db('announcements').first()).archived_at).toBeTruthy();

    // Directors no longer delete permanently; the Admin can restore and delete permanently.
    const director = await signIn(app, await makeUser('program_director'));
    expect((await post(director, `/portal/announcements/${id}`, `/portal/announcements/${id}/delete`)).status).toBe(403);
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'restore' });
    expect((await db('announcements').first()).archived_at).toBeNull();
    await post(admin, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'delete' });
    await post(admin, `/portal/announcements/${id}`, `/portal/announcements/${id}/delete`);
    expect(await db('announcements').first()).toBeUndefined();
    expect(await db('audit_log').where({ action: 'announcement.soft_delete' }).count({ n: '*' }).first()).toMatchObject({ n: 2 });
  });

  it('shows quick actions on the dashboard staff board only where allowed', async () => {
    const coordinatorUser = await makeUser('program_coordinator');
    const coordinator = await signIn(app, coordinatorUser);
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST({ audience: 'internal', title: 'Board post' }));
    const { id } = await db('announcements').first();
    const mine = (await coordinator.get('/portal')).text;
    expect(mine).toContain(`action="/portal/announcements/${id}/pause"`);
    expect(mine).toContain(`action="/portal/announcements/${id}/archive"`);

    const other = (await (await signIn(app, await makeUser('program_coordinator', 'Other'))).get('/portal')).text;
    expect(other).toContain(`action="/portal/announcements/${id}/pause"`);
    expect(other).not.toContain(`action="/portal/announcements/${id}/archive"`); // not their post

    const reception = (await (await signIn(app, await makeUser('reception'))).get('/portal')).text;
    expect(reception).toContain('Board post');
    expect(reception).not.toContain(`action="/portal/announcements/${id}/pause"`);
  });
});
