import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const insights = require('../src/services/insights');
const workday = require('../src/services/workday');
const roles = require('../src/services/roles');
const { marylandDateTime, marylandParts, addDaysIso, weekStartIso } = require('../src/lib/hours');

const app = createApp();
const HOUR = 3600000;

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('message_reads').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('password_tokens').del();
  await db('users').del();
  await resetRoles();
});

afterAll(() => db.destroy());

async function staff(role, over = {}) {
  const user = await makeUser(role);
  if (Object.keys(over).length) await db('users').where({ id: user.id }).update(over);
  const r = await roles.get(role);
  return { ...user, ...over, status: 'active', permissions: r.permissions, scheduleScope: r.scheduleScope };
}

async function intake(type, { services = [], county = null, at = new Date(), answeredAfterHours = null, by = null } = {}) {
  const [id] = await db('contact_messages').insert({
    type, recipient: 'intake', name: 'Sample', email: 's@example.com', message: 'x', email_status: 'sent', created_at: at,
    details: JSON.stringify({ services, county }),
  });
  if (answeredAfterHours !== null) {
    await db('contact_message_events').insert({ message_id: id, user_id: by, user_name: 'Staff', kind: 'reply', created_at: new Date(at.getTime() + answeredAfterHours * HOUR) });
  }
  return id;
}

describe('office hours', () => {
  it('counts only opening hours, so weekends do not make replies look slow', () => {
    const fri4pm = marylandDateTime('2026-10-09', '16:00');
    const mon10am = marylandDateTime('2026-10-12', '10:00');
    expect(insights.officeHoursBetween(fri4pm, mon10am)).toBe(2);
    expect(insights.officeHoursBetween(marylandDateTime('2026-10-10', '11:00'), marylandDateTime('2026-10-12', '09:30'))).toBe(0.5);
  });

  it('describes long waits in office days', () => {
    expect(insights.describeHours(3.25)).toEqual({ value: '3.3 h', unit: 'office hours' });
    expect(insights.describeHours(20)).toEqual({ value: '2.5 d', unit: 'office days' });
  });
});

describe('response time', () => {
  it('reports the median wait and how many are still unanswered', async () => {
    const admin = await staff('admin');
    // Monday of last week, 10:00, answered within office hours.
    const today = marylandParts(new Date()).date;
    const monday = marylandDateTime(weekStartIso(addDaysIso(today, -7)), '10:00');
    await intake('referral', { at: monday, answeredAfterHours: 1, by: admin.id });
    await intake('referral', { at: monday, answeredAfterHours: 3, by: admin.id });
    await intake('request', { at: monday, answeredAfterHours: 5, by: admin.id });
    await intake('request', { at: new Date() }); // not answered yet

    const chart = await insights.responseTime(admin, today);
    expect(chart.figure.value).toBe('3 h');
    expect(chart.noTotals).toBe(true);
    const weekValues = chart.series.flatMap((s) => s.values).filter((v) => v !== null);
    expect(weekValues).toEqual(expect.arrayContaining([2, 5])); // referral median 2 h, request 5 h
  });

  it('is hidden from people without inbox access', async () => {
    expect(await insights.responseTime(await staff('it_admin'), '2026-10-10')).toBeNull();
  });
});

describe('demand', () => {
  it('counts services chosen and counties, keeping Baltimore County apart from the city', async () => {
    const admin = await staff('admin');
    await intake('referral', { services: ['respite-care', 'employment-services'], county: 'Baltimore County' });
    await intake('request', { services: ['respite-care'], county: 'Baltimore City' });
    await intake('request', { services: [], county: 'Howard County' });

    const [services, counties] = await insights.demand(admin, marylandParts(new Date()).date);
    const count = (chart, label) => chart.series[0].values[chart.categories.indexOf(label)];
    expect(count(services, 'Respite')).toBe(2);
    expect(count(services, 'Employment Services')).toBe(1);
    expect(count(services, 'Not sure yet')).toBe(1);
    expect(services.categories).toContain('CDS');
    expect(count(counties, 'Baltimore County')).toBe(1);
    expect(count(counties, 'Baltimore City')).toBe(1);
    expect(count(counties, 'Howard')).toBe(1);

    // Busiest county first, and the headline names it.
    await intake('request', { services: ['respite-care'], county: 'Howard County' });
    const [, sorted] = await insights.demand(admin, marylandParts(new Date()).date);
    expect(sorted.categories[0]).toBe('Howard');
    expect(sorted.series[0].values).toEqual([...sorted.series[0].values].sort((a, b) => b - a));
    expect(sorted.figure.label).toBe('from Howard');
  });

  it('appears on the admin dashboard', async () => {
    const page = await (await signIn(app, await makeUser('admin'))).get('/portal');
    for (const t of ['Response time', 'Services requested', 'Where requests come from']) expect(page.text).toContain(t);
  });
});

describe('staff account security', () => {
  it('lists people without two-step sign-in, locked accounts and waiting invites', async () => {
    const admin = await staff('admin', { mfa_enabled: true });
    await staff('reception'); // no two-step
    const locked = await staff('intake_specialist', { mfa_enabled: true, locked_until: new Date(Date.now() + HOUR) });
    const invited = await staff('program_coordinator', { must_change_password: true });
    await db('password_tokens').insert({ user_id: invited.id, purpose: 'invite', token_hash: 'a'.repeat(64), expires_at: new Date(Date.now() - HOUR) });

    const sec = await workday.staffSecurity(admin);
    expect(sec.noTwoStep.map((u) => u.role_name)).toEqual(['Reception']); // the invitee is not counted twice
    expect(sec.locked.map((u) => u.id)).toEqual([locked.id]);
    expect(sec.invited).toHaveLength(1);
    expect(sec.invited[0].expired).toBe(true);
  });

  it('is shown only to people who manage accounts', async () => {
    expect(await workday.staffSecurity(await staff('reception'))).toBeNull();
    const adminPage = await (await signIn(app, await makeUser('admin'))).get('/portal');
    expect(adminPage.text).toContain('Staff account security');
    const receptionPage = await (await signIn(app, await makeUser('reception'))).get('/portal');
    expect(receptionPage.text).not.toContain('Staff account security');
  });
});
