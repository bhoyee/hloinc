import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const health = require('../src/services/health');
const { notify } = require('../src/services/notify');
const config = require('../src/config');

const app = createApp();

beforeEach(async () => {
  await db('email_log').del();
  await db('usage_counters').del();
  await db('notifications').del();
  await db('audit_log').del();
  await db('site_settings').whereIn('key', ['health.alerted', 'alerts.routing']).del();
  await db('users').del();
  await resetRoles();
  require('../src/services/content').clearCache();
});

afterAll(async () => {
  await db('email_log').del();
  await db('usage_counters').del();
  await db.destroy();
});

const keys = async () => (await health.snapshot()).problems.map((p) => p.key);

describe('system health', () => {
  it('masks recipients in the email log', () => {
    expect(health.mask('jane.doe@gmail.com')).toBe('j***@gmail.com');
    expect(health.mask('HLO <info@hloinc.com>, bob@example.com')).toBe('i***@hloinc.com, b***@example.com');
  });

  it('logs every email the portal sends', async () => {
    await notify({ to: 'someone@example.com', subject: 'Hello', text: 'Hi' });
    const row = await db('email_log').first();
    expect(row).toMatchObject({ recipient: 's***@example.com', subject: 'Hello', ok: 1, error: null });
  });

  it('flags failing email when the last send failed', async () => {
    await db('email_log').insert([{ recipient: 'a***@x.com', subject: 'One', ok: true }, { recipient: 'b***@x.com', subject: 'Two', ok: false, error: 'Invalid login: 535 Authentication failed' }]);
    const s = await health.snapshot();
    expect(s.problems[0]).toMatchObject({ key: 'email_failing', severity: 'bad' });
    expect(s.problems[0].detail).toContain('535 Authentication failed');
    expect(s.email.day).toEqual({ sent: 1, failed: 1 });
    await db('email_log').insert({ recipient: 'c***@x.com', subject: 'Three', ok: true });
    expect(await keys()).not.toContain('email_failing');
  });

  it('counts virus scans and flags a failing scanner', async () => {
    await require('../src/services/virusScan').scan(Buffer.from('a harmless file'));
    expect((await db('usage_counters').where({ key: 'scan_ok' }).first()).count).toBe(1);
    await db('usage_counters').insert({ key: 'scan_error', period: '2026-10', count: 1, last_at: db.raw('NOW() + INTERVAL 1 MINUTE'), last_detail: 'Could not reach the virus scanner' });
    // Only counts if it's this month's counter.
    const month = require('../src/lib/hours').marylandParts(new Date()).date.slice(0, 7);
    await db('usage_counters').where({ key: 'scan_error' }).update({ period: month });
    expect(await keys()).toContain('scanner_failing');
  });

  it('warns when the Cloudmersive allowance is nearly used', async () => {
    const before = { ...config.virusScan };
    Object.assign(config.virusScan, { mode: 'cloudmersive', cloudmersiveKey: 'test-key', cloudmersiveLimit: 100 });
    try {
      const month = require('../src/lib/hours').marylandParts(new Date()).date.slice(0, 7);
      await db('usage_counters').insert({ key: 'cloudmersive', period: month, count: 85 });
      const s = await health.snapshot();
      expect(s.scanner.cloudmersive).toEqual({ used: 85, limit: 100, pct: 85 });
      expect(s.problems.map((p) => p.key)).toContain('cloudmersive_high');
      await db('usage_counters').where({ key: 'cloudmersive' }).update({ count: 100 });
      expect(await keys()).toContain('cloudmersive_used');
    } finally {
      Object.assign(config.virusScan, before);
    }
  });

  it('flags backups that fail', async () => {
    await db('usage_counters').insert({ key: 'backup_error', period: '2026-10', count: 1, last_at: db.fn.now(), last_detail: 'mysqldump: command not found' });
    const s = await health.snapshot();
    expect(s.problems.find((p) => p.key === 'backup_failing').detail).toBe('mysqldump: command not found');
  });

  it('tells IT and Admin about a new problem once a day, by bell and email', async () => {
    const it = await makeUser('it_admin');
    const admin = await makeUser('admin');
    await makeUser('reception');
    await db('email_log').insert({ recipient: 'b***@x.com', subject: 'Two', ok: false, error: 'Connection timed out' });
    const first = await health.check({ autoBackup: false });
    expect(first.alerted).toEqual(['email_failing']);
    const told = await db('notifications').where({ type: 'system' }).pluck('user_id');
    expect(told.sort()).toEqual([it.id, admin.id].sort());
    const again = await health.check({ autoBackup: false });
    expect(again.alerted).toEqual([]);
    // A day later it's mentioned again if still broken. (Here the alert emails themselves went
    // through, which counts as email working again, so fail one more to keep it broken.)
    await db('email_log').insert({ recipient: 'b***@x.com', subject: 'Three', ok: false, error: 'Connection timed out' });
    const later = await health.check({ autoBackup: false, now: Date.now() + 25 * 3600 * 1000 });
    expect(later.alerted).toEqual(['email_failing']);
  });
});

describe('system health page', () => {
  it('is for IT and Admin, and shows a menu counter of problems', async () => {
    const it = await signIn(app, await makeUser('it_admin'));
    const page = await it.get('/portal/system');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Virus scanner');
    expect(page.text).toContain('Database backups');
    expect(page.text).toContain('href="/portal/system"');
    const reception = await signIn(app, await makeUser('reception'));
    expect((await reception.get('/portal/system')).status).toBe(403);
    expect((await reception.get('/portal')).text).not.toContain('href="/portal/system"');
  });

  it('sends a test email and tests the scanner, logged in the audit log', async () => {
    const user = await makeUser('it_admin');
    const it = await signIn(app, user);
    await post(it, '/portal/system', '/portal/system/test-email');
    expect(await db('email_log').where({ subject: 'HLO portal: test email', ok: true }).count({ n: '*' }).first()).toEqual({ n: 1 });
    await post(it, '/portal/system', '/portal/system/test-scanner');
    const actions = await db('audit_log').pluck('action');
    expect(actions).toEqual(expect.arrayContaining(['system.test_email', 'system.test_scanner']));
  });

  it('lets view-only roles see the page but not run the checks', async () => {
    const role = await db('roles').where({ key: 'program_director' }).first();
    await db('role_permissions').insert({ role_id: role.id, permission: 'system.view' });
    require('../src/services/roles').clearCache();
    const director = await signIn(app, await makeUser('program_director'));
    const page = await director.get('/portal/system');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('Send a test email to me');
    const res = await post(director, '/portal/system', '/portal/system/test-email');
    expect(res.status).toBe(303);
    expect(await db('email_log').count({ n: '*' }).first()).toEqual({ n: 0 });
  });
});
