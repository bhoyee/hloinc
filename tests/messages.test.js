import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const app = createApp();

async function message(over = {}) {
  const [id] = await db('contact_messages').insert({
    type: 'message',
    recipient: 'general',
    name: 'Pat Visitor',
    email: 'pat@example.com',
    phone: '410-555-0100',
    message: 'Hello, I have a question about your services.',
    email_status: 'sent',
    ...over,
  });
  return id;
}

const referral = () =>
  message({
    type: 'referral',
    recipient: 'intake',
    name: 'Sam Caseworker',
    email: 'sam@agency.example',
    message: 'Family is keen to start soon.',
    details: JSON.stringify({ referrer_role: 'coordinator', organization: 'County CCS', person_name: 'Jordan Person', county: 'Baltimore County', services: ['personal-supports'] }),
  });

beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('users').del();
  await resetRoles();
});

afterAll(() => db.destroy());

describe('inbox: who sees what', () => {
  it('shows everything to full inbox roles, and referral details', async () => {
    await message();
    const refId = await referral();
    const admin = await signIn(app, await makeUser('admin'));
    const list = await admin.get('/portal/messages');
    expect(list.status).toBe(200);
    expect(list.text).toContain('Pat Visitor');
    expect(list.text).toContain('Sam Caseworker');

    const show = await admin.get(`/portal/messages/${refId}`);
    expect(show.text).toContain('Jordan Person');
    expect(show.text).toContain('Baltimore County');
    expect(show.text).toContain('Personal Supports');
    expect(await db('audit_log').where({ action: 'message.view' }).count({ n: '*' }).first()).toEqual({ n: 1 });
    await admin.get(`/portal/messages/${refId}`);
    expect(await db('audit_log').where({ action: 'message.view' }).count({ n: '*' }).first()).toEqual({ n: 1 }); // once per 30 minutes
  });

  it('limits Intake Specialists to intake messages and referrals', async () => {
    const generalId = await message();
    const refId = await referral();
    const intakeMsg = await message({ recipient: 'intake', name: 'Intake Asker' });
    const intake = await signIn(app, await makeUser('intake_specialist'));
    const list = await intake.get('/portal/messages');
    expect(list.text).toContain('Sam Caseworker');
    expect(list.text).toContain('Intake Asker');
    expect(list.text).not.toContain('Pat Visitor');
    expect((await intake.get(`/portal/messages/${generalId}`)).status).toBe(404);
    expect((await intake.get(`/portal/messages/${refId}`)).status).toBe(200);
    expect((await intake.get(`/portal/messages/${intakeMsg}`)).status).toBe(200);
    // Search follows the same limits.
    const search = await intake.get('/portal/search?format=json&q=Visitor');
    expect(search.status).toBe(200);
    expect(JSON.stringify(search.body)).not.toContain('Pat Visitor');
    const caseworker = await intake.get('/portal/search?format=json&q=Caseworker');
    expect(JSON.stringify(caseworker.body)).toContain('Sam Caseworker');
  });

  it('gives Reception read-only access', async () => {
    const id = await message();
    const reception = await signIn(app, await makeUser('reception'));
    const show = await reception.get(`/portal/messages/${id}`);
    expect(show.status).toBe(200);
    expect(show.text).toContain('can read the inbox but not change it');
    expect(show.text).not.toContain('Send reply');
    expect((await post(reception, `/portal/messages/${id}`, `/portal/messages/${id}/status`, { status: 'resolved' })).status).toBe(403);
    expect((await db('contact_messages').where({ id }).first()).status).toBe('new');
  });

  it('keeps people with no inbox access out', async () => {
    const it_ = await signIn(app, await makeUser('it_admin'));
    expect((await it_.get('/portal/messages')).status).toBe(403);
  });
});

describe('inbox: handling', () => {
  it('changes status and keeps a history', async () => {
    const id = await message();
    const coordinator = await signIn(app, await makeUser('program_coordinator', 'Casey Coordinator'));
    await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/status`, { status: 'resolved' });
    expect((await db('contact_messages').where({ id }).first()).status).toBe('resolved');
    const event = await db('contact_message_events').where({ message_id: id }).first();
    expect(event).toMatchObject({ kind: 'status', body: 'New → Resolved', user_name: 'Casey Coordinator' });
    expect(await db('audit_log').where({ action: 'message.status' }).first()).toBeTruthy();
  });

  it('adds internal notes, and rejects empty ones', async () => {
    const id = await message();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/note`, { note: '   ' })).status).toBe(422);
    await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/note`, { note: 'Called back, left voicemail.' });
    const show = await coordinator.get(`/portal/messages/${id}`);
    expect(show.text).toContain('Called back, left voicemail.');
  });

  it('emails a reply and moves a new message to in progress', async () => {
    const id = await message();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const res = await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/reply`, { reply: 'Thanks for getting in touch. We will call you tomorrow.' });
    expect(res.status).toBe(303);
    const event = await db('contact_message_events').where({ message_id: id, kind: 'reply' }).first();
    expect(event.email_status).toBe('sent');
    expect((await db('contact_messages').where({ id }).first()).status).toBe('in_progress');
  });

  it('assigns only to staff who can see the message, and notifies them', async () => {
    const generalId = await message();
    const refId = await referral();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const intakeUser = await makeUser('intake_specialist', 'Ivy Intake');

    // An Intake Specialist can't see general messages, so can't be given one.
    await post(coordinator, `/portal/messages/${generalId}`, `/portal/messages/${generalId}/assign`, { assigned_to: intakeUser.id });
    expect((await db('contact_messages').where({ id: generalId }).first()).assigned_to).toBeNull();

    await post(coordinator, `/portal/messages/${refId}`, `/portal/messages/${refId}/assign`, { assigned_to: intakeUser.id });
    expect((await db('contact_messages').where({ id: refId }).first()).assigned_to).toBe(intakeUser.id);
    expect(await db('notifications').where({ user_id: intakeUser.id }).first()).toMatchObject({ link: `/portal/messages/${refId}` });
  });
});

describe('inbox: archive and delete', () => {
  it('archives and permanently deletes with the right permissions', async () => {
    const id = await message();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/archive`)).status).toBe(403);

    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/delete`);
    expect(await db('contact_messages').where({ id }).first()).toBeTruthy(); // must be archived first

    await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/archive`, { action: 'archive' });
    const archived = await admin.get('/portal/messages?tab=archived');
    expect(archived.text).toContain('Pat Visitor');
    expect((await admin.get('/portal/messages?tab=new')).text).not.toContain('Pat Visitor');

    await post(admin, `/portal/messages/${id}`, `/portal/messages/${id}/delete`);
    expect(await db('contact_messages').where({ id }).first()).toBeUndefined();
    expect(await db('audit_log').where({ action: 'message.delete' }).first()).toBeTruthy();
  });
});

describe('inbox: website submissions', () => {
  it('links the staff notification to the new message', async () => {
    await makeUser('program_coordinator');
    const inquiries = (await import('../src/services/inquiries.js')).default;
    const { id } = await inquiries.submitContact({ recipient: 'general', name: 'Web Visitor', email: 'web@example.com', phone: '', message: 'Hi there, a question.' }, { ip: '127.0.0.1' });
    const n = await db('notifications').first();
    expect(n.link).toBe(`/portal/messages/${id}`);
  });
});
