import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const config = require('../src/config');
const appointments = require('../src/services/appointments');
const appointmentEmails = require('../src/services/appointmentEmails');
const applications = require('../src/services/applications');
const { _outbox: outbox } = require('../src/services/notify');
const { marylandParts, marylandDateTime, addDaysIso } = require('../src/lib/hours');

const app = createApp();
const today = marylandParts(new Date()).date;
const tomorrow = addDaysIso(today, 1);
const at = (date, time) => marylandDateTime(date, time);
let typeId;

beforeEach(async () => {
  await db('appointments').del();
  await db('job_applications').del();
  await db('audit_log').del();
  await db('users').del();
  await db('appointment_types').del();
  await resetRoles();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  outbox.length = 0;
  config.appointments.reminders = true;
});

afterAll(() => db.destroy());

const appt = (over = {}) => ({ type_id: typeId, source: 'website', status: 'confirmed', name: 'Jordan Example', email: 'jordan@example.com', reference: `HLO-APT-${crypto.randomBytes(3).toString('hex').toUpperCase().replace(/[01IO]/g, '2')}`, scheduled_at: at(tomorrow, '14:30'), ...over });
const reminders = () => outbox.filter((m) => m.subject.startsWith('Reminder:'));

describe('appointment reminders', () => {
  it('emails confirmed appointments the day before, from 10 a.m., once', async () => {
    const [id] = await db('appointments').insert(appt());
    await db('appointments').insert([
      appt({ status: 'requested', name: 'Not confirmed' }),
      appt({ status: 'cancelled', name: 'Cancelled' }),
      appt({ email: null, phone: '410-555-0100', name: 'Phone only' }),
      appt({ scheduled_at: at(addDaysIso(today, 2), '10:00'), name: 'Day after' }),
    ]);
    expect(await appointments.sendReminders(at(today, '09:30'))).toEqual({ sent: 0, failed: 0 }); // too early
    expect(await appointments.sendReminders(at(today, '10:05'))).toEqual({ sent: 1, failed: 0 });
    const mail = reminders();
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe('jordan@example.com');
    expect(mail[0].subject).toBe('Reminder: your appointment tomorrow at 2:30 p.m.');
    expect(mail[0].html).toContain('Add to Google Calendar');
    expect(mail[0].html).toContain('Get directions');
    expect(mail[0].text).toContain('2:30 p.m. – 3:30 p.m.');
    expect(await db('appointments').where({ id }).first()).toMatchObject({ reminder_status: 'sent', reminder_attempts: 1 });
    expect(await appointments.sendReminders(at(today, '16:00'))).toEqual({ sent: 0, failed: 0 }); // not twice
  });

  it('sends a new reminder when the appointment is moved, and retries failures', async () => {
    const [id] = await db('appointments').insert(appt());
    await appointments.sendReminders(at(today, '11:00'));
    await db('appointments').where({ id }).update({ scheduled_at: at(tomorrow, '09:00') });
    expect((await appointments.sendReminders(at(today, '11:15'))).sent).toBe(1);

    // A send that fails is tried again, up to three times.
    await db('appointments').where({ id }).update({ scheduled_at: at(tomorrow, '15:00') });
    const real = appointmentEmails.reminder;
    appointmentEmails.reminder = async () => ({ ok: false, error: 'SMTP down' });
    try {
      for (let i = 0; i < 4; i++) await appointments.sendReminders(at(today, '12:00'));
    } finally {
      appointmentEmails.reminder = real;
    }
    expect(await db('appointments').where({ id }).first()).toMatchObject({ reminder_status: 'failed', reminder_attempts: 3 });
  });

  it('can be switched off with APPOINTMENT_REMINDERS=false', async () => {
    config.appointments.reminders = false;
    await db('appointments').insert(appt());
    expect(await appointments.sendReminders(at(today, '11:00'))).toEqual({ sent: 0, failed: 0 });
  });

  it('shows the reminder on the appointment page', async () => {
    const [id] = await db('appointments').insert(appt());
    const agent = await signIn(app, await makeUser('reception'));
    expect((await agent.get(`/portal/appointments/${id}`)).text).toContain('A reminder is emailed the day before');
    await appointments.sendReminders(at(today, '10:30'));
    expect((await agent.get(`/portal/appointments/${id}`)).text).toContain('Reminder emailed');
  });
});

describe('resume clean-up', () => {
  const dir = path.join(config.paths.storage, 'applications');
  const fakeResume = () => {
    const name = crypto.randomBytes(16).toString('hex');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, `${name}.bin`), 'encrypted');
    return name;
  };
  const application = (over) => ({ job_title: 'Direct Support Professional', first_name: 'Pat', last_name: 'Applicant', email: 'p@example.com', phone: '1', scan_status: 'clean', resume_name: 'pat.pdf', resume_type: 'pdf', ...over });

  it('deletes resumes older than 3 months and keeps the application', async () => {
    const oldFile = fakeResume();
    const newFile = fakeResume();
    const [oldId] = await db('job_applications').insert(application({ reference: 'HLO-APP-OLDAA2', resume_file: oldFile, created_at: db.raw('NOW() - INTERVAL 91 DAY') }));
    const [newId] = await db('job_applications').insert(application({ reference: 'HLO-APP-NEWAA2', resume_file: newFile, created_at: db.raw('NOW() - INTERVAL 30 DAY') }));
    expect(await applications.purgeOldResumes()).toBe(1);

    const old = await db('job_applications').where({ id: oldId }).first();
    expect(old.resume_file).toBeNull();
    expect(old.resume_deleted_at).not.toBeNull();
    expect(fs.existsSync(path.join(dir, `${oldFile}.bin`))).toBe(false);
    expect((await db('job_applications').where({ id: newId }).first()).resume_file).toBe(newFile);
    expect(fs.existsSync(path.join(dir, `${newFile}.bin`))).toBe(true);
    expect((await db('audit_log').where({ action: 'application.resume_expired' }).first()).summary).toContain('1 resume older than 90 days');

    const agent = await signIn(app, await makeUser('admin'));
    expect((await agent.get(`/portal/applications/${oldId}`)).text).toContain('Deleted automatically');
    expect((await agent.get(`/portal/applications/${newId}`)).text).toContain('Download it before then');
    fs.rmSync(path.join(dir, `${newFile}.bin`), { force: true });
  });
});
