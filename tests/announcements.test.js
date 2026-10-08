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

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('announcements').del();
  await db('users').del();
  await resetRoles();
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

    expect(await db('notifications').where({ user_id: reception.id, type: 'announcement' }).first()).toBeTruthy();
    expect(await db('notifications').where({ user_id: coordinator.id }).first()).toBeUndefined();
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
    expect(scheduled.text).not.toContain('Current news');
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

describe('announcements: end, archive and delete', () => {
  it('ends, archives, restores and deletes with the right permissions', async () => {
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    await post(coordinator, '/portal/announcements/new', '/portal/announcements', POST());
    const { id } = await db('announcements').first();

    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/end`);
    expect((await request(app).get('/')).text).not.toContain('Office closed Monday');

    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'archive' });
    expect((await db('announcements').first()).archived_at).toBeTruthy();
    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'restore' });
    expect((await db('announcements').first()).archived_at).toBeNull();

    // Coordinators can't delete permanently; directors can, once archived.
    await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/archive`, { action: 'archive' });
    expect((await post(coordinator, `/portal/announcements/${id}`, `/portal/announcements/${id}/delete`)).status).toBe(403);
    const director = await signIn(app, await makeUser('program_director'));
    await post(director, `/portal/announcements/${id}`, `/portal/announcements/${id}/delete`);
    expect(await db('announcements').first()).toBeUndefined();
  });
});
