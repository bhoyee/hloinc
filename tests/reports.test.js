import { describe, it, expect, beforeEach, afterEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const features = require('../src/lib/features');
// Tests that turn on website appointment requests put the switch back afterwards.
afterEach(() => {
  features.appointmentRequests = false;
});
const report = require('../src/services/monthlyReport');
const { marylandDateTime } = require('../src/lib/hours');

const app = createApp();
const at = (date, time = '10:00') => marylandDateTime(date, time);
const kpi = (r, label) => r.kpis.find((k) => k.label === label);
const metric = (r, section, label) => r.sections.find((s) => s.key === section).metrics.find((m) => m.label === label);

let typeId;
let jobId;

beforeEach(async () => {
  await db('lead_events').del();
  await db('contact_messages').del();
  await db('appointments').del();
  await db('leads').del();
  await db('job_applications').del();
  await db('jobs').del();
  await db('audit_log').del();
  await db('users').del();
  await db('appointment_types').del();
  await resetRoles();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  [jobId] = await db('jobs').insert({ title: 'Direct Support Professional', slug: 'dsp', status: 'published', published_at: at('2026-09-03'), description: 'x' });
});

afterAll(() => db.destroy());

async function seedSeptember() {
  const msg = (type, created, extra = {}) => ({ type, recipient: type === 'message' ? 'general' : 'intake', name: 'Private Person', email: 'private@example.com', message: 'hi', created_at: created, ...extra });
  await db('contact_messages').insert([
    msg('referral', at('2026-09-01', '00:30'), { details: JSON.stringify({ county: 'Howard County', services: ['respite'] }) }), // just inside (Maryland time)
    msg('referral', at('2026-09-30', '23:30')),
    msg('referral', at('2026-08-31', '23:30')), // August
    msg('request', at('2026-09-10'), { details: JSON.stringify({ county: 'Howard County', services: [] }) }),
    msg('message', at('2026-09-12')),
  ]);
  await db('appointments').insert([
    { type_id: typeId, source: 'website', status: 'completed', name: 'A', scheduled_at: at('2026-09-08'), created_at: at('2026-09-02') },
    { type_id: typeId, source: 'phone', status: 'completed', name: 'B', scheduled_at: at('2026-09-09'), created_at: at('2026-08-20') },
    { type_id: typeId, source: 'walk_in', status: 'no_show', name: 'C', scheduled_at: at('2026-09-10'), created_at: at('2026-09-10') },
    { type_id: typeId, source: 'website', status: 'cancelled', name: 'D', scheduled_at: at('2026-09-11'), created_at: at('2026-09-05') },
    { type_id: typeId, source: 'website', status: 'completed', name: 'E', scheduled_at: at('2026-08-11'), created_at: at('2026-08-05') },
  ]);
  const [leadId] = await db('leads').insert({ name: 'Private Person', origin: 'referral', stage: 'client', created_at: at('2026-09-01', '09:00') });
  await db('lead_events').insert({ lead_id: leadId, kind: 'stage', body: 'Stage changed from Intake in progress to Became a client.', created_at: at('2026-09-20') });
  await db('job_applications').insert([
    { reference: 'HLO-APP-AAAAA2', job_id: jobId, job_title: 'Direct Support Professional', first_name: 'Pat', last_name: 'Applicant', email: 'p@example.com', phone: '1', status: 'hired', hired_at: at('2026-09-25'), created_at: at('2026-08-28') },
    { reference: 'HLO-APP-AAAAA3', job_id: jobId, job_title: 'Direct Support Professional', first_name: 'Sam', last_name: 'Applicant', email: 's@example.com', phone: '1', status: 'new', created_at: at('2026-09-14') },
  ]);
}

describe('monthly report', () => {
  it('counts each area in Maryland time and compares with the month before', async () => {
    features.appointmentRequests = true; // website appointment requests switched on (lib/features.js)
    await seedSeptember();
    const r = await report.build('2026-09', { now: new Date('2026-10-05T12:00:00Z') });
    expect(r.label).toBe('September 2026');
    expect(r.partial).toBe(false);
    expect(kpi(r, 'Referrals')).toMatchObject({ value: 2, prev: 1 });
    expect(kpi(r, 'Referrals').change.text).toBe('+1 (+100%) vs last month');
    expect(kpi(r, 'Service requests').value).toBe(1);
    expect(kpi(r, 'Appointments held')).toMatchObject({ value: 2, prev: 1 });
    expect(kpi(r, 'New clients').value).toBe(1);
    expect(kpi(r, 'Job applications')).toMatchObject({ value: 1, prev: 1 });
    expect(kpi(r, 'Hires')).toMatchObject({ value: 1, prev: 0 });
    expect(metric(r, 'appointments', 'Requests from the website').value).toBe(2);
    expect(metric(r, 'appointments', 'No-shows').value).toBe(1);
    expect(metric(r, 'appointments', 'Cancelled').value).toBe(1);
    expect(metric(r, 'appointments', 'Attendance rate').value).toBe('67%');
    expect(metric(r, 'careers', 'Jobs posted').value).toBe(1);
    expect(metric(r, 'contact', 'Messages received').value).toBe(1);
    const counties = r.sections.find((s) => s.key === 'intake').breakdowns.find((b) => b.title === 'Counties');
    expect(counties.rows).toEqual([{ label: 'Howard County', value: 2 }]);
    const booked = r.sections.find((s) => s.key === 'appointments').breakdowns[0];
    expect(booked.rows.map((x) => x.label)).not.toContain('Cancelled');
  });

  it('never includes names or contact details', async () => {
    await seedSeptember();
    const r = await report.build('2026-09');
    const all = JSON.stringify(r) + report.toCsv(r);
    for (const secret of ['Private Person', 'private@example.com', 'Applicant', 'p@example.com']) expect(all).not.toContain(secret);
  });

  it('makes a CSV that opens safely in Excel', async () => {
    await seedSeptember();
    const csv = report.toCsv(await report.build('2026-09'));
    expect(csv.startsWith('﻿')).toBe(true);
    expect(csv).toContain('Section,Measure,September 2026,August 2026');
    expect(csv).toContain('Highlights,Referrals,2,1');
    expect(csv).toContain('Appointments,Attendance rate,67%,100%');
  });

  it('records when an application is marked hired', async () => {
    await seedSeptember();
    const a = await db('job_applications').where({ status: 'new' }).first();
    const { setStatus } = require('../src/services/applications');
    await setStatus(a, 'hired');
    expect((await db('job_applications').where({ id: a.id }).first()).hired_at).not.toBeNull();
    await setStatus({ ...a, status: 'hired' }, 'not_selected');
    expect((await db('job_applications').where({ id: a.id }).first()).hired_at).toBeNull();
  });
});

describe('reports page', () => {
  it('shows the report and downloads a PDF and a CSV, logged in the audit log', async () => {
    await seedSeptember();
    const agent = await signIn(app, await makeUser('admin'));
    const page = await agent.get('/portal/reports?month=2026-09');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Monthly report');
    expect(page.text).toContain('/portal/reports/2026-09.pdf');
    expect(page.text).toContain('Referrals and service requests');

    const pdf = await agent.get('/portal/reports/2026-09.pdf').buffer(true).parse((res, cb) => {
      const chunks = [];
      res.on('data', (c) => chunks.push(c));
      res.on('end', () => cb(null, Buffer.concat(chunks)));
    });
    expect(pdf.status).toBe(200);
    expect(pdf.headers['content-type']).toBe('application/pdf');
    expect(pdf.headers['content-disposition']).toContain('HLO-monthly-report-2026-09.pdf');
    expect(pdf.body.subarray(0, 5).toString()).toBe('%PDF-');

    const csv = await agent.get('/portal/reports/2026-09.csv');
    expect(csv.headers['content-type']).toContain('text/csv');
    expect(csv.text).toContain('Highlights,Hires,1,0');
    expect(await db('audit_log').where({ action: 'report.download' }).count({ n: '*' }).first()).toEqual({ n: 2 });
  });

  it('is only for roles given the monthly report', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    expect((await director.get('/portal/reports')).status).toBe(403);
    expect((await director.get('/portal/reports/2026-09.pdf')).status).toBe(403);
    expect((await director.get('/portal')).text).not.toContain('href="/portal/reports"');
    const role = await db('roles').where({ key: 'program_director' }).first();
    // View only: the report on screen, but no downloads.
    await db('role_permissions').insert({ role_id: role.id, permission: 'monthly_report.view' });
    require('../src/services/roles').clearCache();
    const page = await director.get('/portal/reports');
    expect(page.status).toBe(200);
    expect(page.text).not.toContain('Download PDF');
    expect((await director.get('/portal/reports/2026-09.pdf')).status).toBe(403);
    expect((await director.get('/portal/reports/2026-09.csv')).status).toBe(403);
    // With downloads too.
    await db('role_permissions').insert({ role_id: role.id, permission: 'monthly_report.download' });
    require('../src/services/roles').clearCache();
    expect((await director.get('/portal/reports')).text).toContain('Download PDF');
    expect((await director.get('/portal/reports/2026-09.csv')).status).toBe(200);
  });

  it('falls back to last month for a bad month', async () => {
    const agent = await signIn(app, await makeUser('admin'));
    const res = await agent.get('/portal/reports?month=2026-13');
    expect(res.status).toBe(200);
    expect(res.text).toContain(`${report.defaultMonth()}.pdf`);
    expect((await agent.get('/portal/reports/nonsense.pdf')).status).toBe(404);
  });
});

