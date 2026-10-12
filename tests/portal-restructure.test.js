import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db, nextWeekday } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const { _outbox: outbox } = require('../src/services/notify');
const content = require('../src/services/content');

const app = createApp();

async function message(over = {}) {
  const [id] = await db('contact_messages').insert({
    type: 'message',
    recipient: 'general',
    name: 'Pat Visitor',
    email: 'pat@example.com',
    phone: '410-555-0100',
    message: 'Private question about my brother.',
    email_status: 'sent',
    ...over,
  });
  return id;
}

let typeId;

beforeEach(async () => {
  outbox.length = 0;
  await db('site_settings').whereIn('key', ['alerts.routing', 'contact.recipient_emails']).del();
  content.clearCache();
  await db('notifications').del();
  await db('audit_log').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('appointments').del();
  await db('lead_events').del();
  await db('leads').del();
  await db('appointment_types').del();
  await db('users').del();
  await resetRoles();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
});

afterAll(() => db.destroy());

describe('Messages: Send to…', () => {
  it('lets Reception pass a contact message on; that team is told by bell and email, without the message', async () => {
    const director = await makeUser('program_director', 'Dana Director');
    const receptionUser = await makeUser('reception', 'Rae Reception');
    const id = await message();
    const reception = await signIn(app, receptionUser);

    const page = (await reception.get(`/portal/messages/${id}`)).text;
    expect(page).toContain('Send to…');
    expect(page).not.toContain('Send reply'); // still can't reply or change it

    const res = await post(reception, `/portal/messages/${id}`, `/portal/messages/${id}/send`, { to: 'program_director', note: 'Asking about day programs' });
    expect(res.status).toBe(303);
    expect(res.headers.location).toBe('/portal/messages'); // no longer in Reception's inbox
    expect((await db('contact_messages').where({ id }).first()).recipient).toBe('program_director');

    const event = await db('contact_message_events').where({ message_id: id, kind: 'passed_on' }).first();
    expect(event).toMatchObject({ user_name: 'Rae Reception', body: 'Sent to Program director: Asking about day programs' });
    expect(await db('notifications').pluck('user_id')).toEqual([director.id]);
    expect((await db('notifications').first()).link).toBe(`/portal/messages/${id}`);
    const mail = outbox.find((m) => m.to === director.email);
    expect(mail.subject).toMatch(/Rae Reception sent you a message/);
    expect(mail.text).toContain('Asking about day programs');
    expect(mail.text).not.toContain('my brother');
    expect(await db('audit_log').where({ action: 'message.pass_on' }).first()).toBeTruthy();

    // The director now sees it, with the history.
    const show = (await (await signIn(app, director)).get(`/portal/messages/${id}`)).text;
    expect(show).toContain('Asking about day programs');
  });

  it('rejects the same inbox or an unknown one, and roles without the permission', async () => {
    const id = await message();
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/send`, { to: 'general' });
    await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/send`, { to: 'nowhere' });
    expect((await db('contact_messages').where({ id }).first()).recipient).toBe('general');
    expect(await db('contact_message_events').where({ message_id: id })).toHaveLength(0);

    const intakeId = await message({ recipient: 'intake' });
    const { makeRole } = await import('./portal-helpers.js');
    await makeRole('reader', ['messages.inbox_intake']);
    const reader = await signIn(app, await makeUser('reader'));
    expect((await post(reader, `/portal/messages/${intakeId}`, `/portal/messages/${intakeId}/send`, { to: 'general' })).status).toBe(403);
  });

  it('keeps the message open for someone who can still see it', async () => {
    const id = await message();
    const admin = await signIn(app, await makeUser('admin'));
    const res = await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/send`, { to: 'intake' });
    expect(res.headers.location).toBe(`/portal/messages/${id}`);
  });
});

describe('Messages: quick views', () => {
  it('shows contact messages, intake, or what is assigned to you', async () => {
    const adminUser = await makeUser('admin');
    await message({ name: 'Contact Asker' });
    await message({ type: 'referral', recipient: 'intake', name: 'Referral Sender' });
    await message({ name: 'Mine Asker', assigned_to: adminUser.id });
    const admin = await signIn(app, adminUser);
    const names = async (q) => {
      const text = (await admin.get(`/portal/messages?tab=all${q}`)).text;
      return ['Contact Asker', 'Referral Sender', 'Mine Asker'].filter((n) => text.includes(n));
    };
    expect(await names('')).toEqual(['Contact Asker', 'Referral Sender', 'Mine Asker']);
    expect(await names('&view=contact')).toEqual(['Contact Asker', 'Mine Asker']);
    expect(await names('&view=intake')).toEqual(['Referral Sender']);
    expect(await names('&view=mine')).toEqual(['Mine Asker']);
    expect((await admin.get('/portal/messages?view=contact')).text).toMatch(/aria-current="true"[^>]*>Contact messages/);
  });
});

describe('Appointments: booked by staff, from a message', () => {
  it('starts the booking from the message and links it back', async () => {
    const id = await message({ type: 'request', recipient: 'intake', name: 'Morgan Family', email: 'morgan@example.com' });
    await require('../src/services/leads').attachMessage(id, await db('contact_messages').where({ id }).first());
    const leadId = (await db('contact_messages').where({ id }).first()).lead_id;
    const agent = await signIn(app, await makeUser('intake_specialist'));

    const show = (await agent.get(`/portal/messages/${id}`)).text;
    expect(show).toContain(`/portal/appointments/new?message=${id}`);
    const form = (await agent.get(`/portal/appointments/new?message=${id}`)).text;
    expect(form).toContain('Book a meeting: Morgan Family');
    expect(form).toContain('value="morgan@example.com"');
    expect(form).toContain(`name="message_id" value="${id}"`);

    const res = await post(agent, `/portal/appointments/new?message=${id}`, '/portal/appointments', {
      source: 'phone', type_id: typeId, name: 'Morgan Family', phone: '410-555-0100', email: 'morgan@example.com',
      date: nextWeekday(3), time: '10:00', duration_minutes: 60, message_id: id,
    });
    expect(res.status).toBe(303);
    const appt = await db('appointments').where({ name: 'Morgan Family' }).first();
    expect(appt).toMatchObject({ source: 'phone', status: 'confirmed' });
    expect(leadId).toBeTruthy();
    expect(appt.lead_id).toBe(leadId);
    const event = await db('contact_message_events').where({ message_id: id, kind: 'meeting' }).first();
    expect(event.body).toContain('Intake consultation');
    expect((await agent.get(`/portal/messages/${id}`)).text).toContain('booked a meeting');
  });

  it('ignores a message the person cannot see', async () => {
    const id = await message(); // General inquiry: not Intake's
    const agent = await signIn(app, await makeUser('intake_specialist'));
    const form = (await agent.get(`/portal/appointments/new?message=${id}`)).text;
    expect(form).not.toContain('Pat Visitor');
    expect(form).not.toContain('name="message_id"');
  });

  it('hides website requests while that form is off', async () => {
    await db('appointments').insert({ type_id: typeId, source: 'website', status: 'requested', name: 'Old Request' });
    const adminUser = await makeUser('admin');
    const admin = await signIn(app, adminUser);
    const list = (await admin.get('/portal/appointments')).text;
    expect(list).not.toContain('tab=requests');
    expect((await admin.get('/portal/appointments?tab=requests')).status).toBe(200); // falls back
    const badges = require('../src/services/badges');
    const counts = await badges.forUser({ ...adminUser, permissions: new Set(require('../src/auth/permissions').ALL_PERMISSIONS) });
    expect(counts.appointments).toBeNull();
    const grid = await require('../src/services/alerts').grid();
    expect(grid.rows.map((r) => r.key)).not.toContain('appointment');
  });
});

describe('Menu and settings', () => {
  it('groups the menu by job', async () => {
    const text = (await (await signIn(app, await makeUser('admin'))).get('/portal')).text;
    const nav = text.slice(text.indexOf('aria-label="Portal"'));
    const order = ['Inbox', 'Scheduling', 'Hiring', 'Website', 'Administration'].map((h) => nav.indexOf(`uppercase">${h}</p>`));
    expect(order.every((i) => i > 0)).toBe(true);
    expect([...order].sort((a, b) => a - b)).toEqual(order);
    // Reception: just their own groups.
    const recep = (await (await signIn(app, await makeUser('reception'))).get('/portal')).text;
    expect(recep).toContain('uppercase">Inbox</p>');
    expect(recep).not.toContain('uppercase">Hiring</p>');
  });

  it('keeps the addresses of team mailboxes the website no longer uses', async () => {
    await db('site_settings').insert({ key: 'contact.recipient_emails', value: JSON.stringify({ program_director: 'director@hloinc.com' }) });
    content.clearCache();
    const admin = await signIn(app, await makeUser('admin'));
    const page = (await admin.get('/portal/content/recipients')).text;
    expect(page).toContain('Contact page messages');
    expect(page).toContain('type="hidden" name="program_director" value="director@hloinc.com"');
    expect(page).not.toContain('Appointment requests');
    await post(admin, '/portal/content/recipients', '/portal/content/recipients', { general: 'front@hloinc.com', program_director: 'director@hloinc.com' });
    expect(await content.getRecipientEmail('program_director')).toBe('director@hloinc.com');
    expect(await content.getRecipientEmail('general')).toBe('front@hloinc.com');
  });
});

describe('Monthly report', () => {
  it('counts appointments booked by staff and messages passed on', async () => {
    const report = require('../src/services/monthlyReport');
    const { marylandDateTime } = require('../src/lib/hours');
    const at = (date) => marylandDateTime(date, '10:00');
    await db('appointments').insert([
      { type_id: typeId, source: 'phone', status: 'confirmed', name: 'A', scheduled_at: at('2026-09-08'), created_at: at('2026-09-02') },
      { type_id: typeId, source: 'walk_in', status: 'completed', name: 'B', scheduled_at: at('2026-09-09'), created_at: at('2026-09-09') },
      { type_id: typeId, source: 'phone', status: 'confirmed', name: 'C', scheduled_at: at('2026-09-01'), created_at: at('2026-08-25') }, // booked in August
    ]);
    const id = await message({ created_at: at('2026-09-03') });
    await db('contact_message_events').insert({ message_id: id, kind: 'passed_on', body: 'Sent to Intake specialist', user_name: 'R', created_at: at('2026-09-03') });
    const r = await report.build('2026-09');
    const all = r.sections.flatMap((s) => s.metrics);
    expect(all.find((m) => m.label === 'Appointments booked by staff').value).toBe(2);
    expect(all.find((m) => m.label === 'Passed on to another team').value).toBe(1);
    expect(all.find((m) => m.label === 'Requests from the website')).toBeUndefined();
  });
});
