import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp, db } from './helpers.js';
import { createRequire } from 'module';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const { _outbox: outbox } = require('../src/services/notify');

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
  outbox.length = 0;
  await db('site_settings').where({ key: 'alerts.routing' }).del();
  require('../src/services/content').clearCache();
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
    expect(show.text).toContain('Personal Support');
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
    const messagesGroup = (body) => JSON.stringify(body.groups.filter((g) => g.label === 'Messages'));
    expect(messagesGroup(search.body)).not.toContain('Pat Visitor');
    const caseworker = await intake.get('/portal/search?format=json&q=Caseworker');
    expect(messagesGroup(caseworker.body)).toContain('Sam Caseworker');
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

  it('shows each role only its own inboxes; CEO/COO is Admin only; the Director also sees intake', async () => {
    await message({ name: 'General Asker' });
    await message({ recipient: 'executive', name: 'Exec Asker' });
    await message({ recipient: 'program_director', name: 'Director Asker' });
    await message({ recipient: 'program_coordinator', name: 'Coordinator Asker' });
    await referral();
    const names = ['General Asker', 'Exec Asker', 'Director Asker', 'Coordinator Asker', 'Sam Caseworker'];
    const sees = async (role) => {
      const text = (await (await signIn(app, await makeUser(role))).get('/portal/messages?tab=all')).text;
      return names.filter((n) => text.includes(n));
    };
    expect(await sees('admin')).toEqual(names);
    expect(await sees('reception')).toEqual(['General Asker']);
    expect(await sees('program_director')).toEqual(['Director Asker', 'Sam Caseworker']);
    expect(await sees('program_coordinator')).toEqual(['Coordinator Asker']);
    expect(await sees('intake_specialist')).toEqual(['Sam Caseworker']);
  });

  it('labels contact form messages', async () => {
    await message();
    const text = (await (await signIn(app, await makeUser('admin'))).get('/portal/messages')).text;
    expect(text).toContain('Contact form</span>');
  });

  it('keeps people with no inbox access out', async () => {
    const it_ = await signIn(app, await makeUser('it_admin'));
    expect((await it_.get('/portal/messages')).status).toBe(403);
  });
});

const forCoordinator = () => message({ recipient: 'program_coordinator' });

describe('inbox: handling', () => {
  it('changes status and keeps a history', async () => {
    const id = await forCoordinator();
    const coordinator = await signIn(app, await makeUser('program_coordinator', 'Casey Coordinator'));
    await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/status`, { status: 'resolved' });
    expect((await db('contact_messages').where({ id }).first()).status).toBe('resolved');
    const event = await db('contact_message_events').where({ message_id: id }).first();
    expect(event).toMatchObject({ kind: 'status', body: 'New → Resolved', user_name: 'Casey Coordinator' });
    expect(await db('audit_log').where({ action: 'message.status' }).first()).toBeTruthy();
  });

  it('adds internal notes, and rejects empty ones', async () => {
    const id = await forCoordinator();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    expect((await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/note`, { note: '   ' })).status).toBe(422);
    await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/note`, { note: 'Called back, left voicemail.' });
    const show = await coordinator.get(`/portal/messages/${id}`);
    expect(show.text).toContain('Called back, left voicemail.');
  });

  it('emails a reply and moves a new message to in progress', async () => {
    const id = await forCoordinator();
    const coordinator = await signIn(app, await makeUser('program_coordinator'));
    const res = await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/reply`, { reply: 'Thanks for getting in touch. We will call you tomorrow.' });
    expect(res.status).toBe(303);
    const event = await db('contact_message_events').where({ message_id: id, kind: 'reply' }).first();
    expect(event.email_status).toBe('sent');
    expect((await db('contact_messages').where({ id }).first()).status).toBe('in_progress');
  });

  it('assigns to staff who work from the inbox, which lets them see it, and notifies them', async () => {
    const generalId = await message();
    const admin = await signIn(app, await makeUser('admin'));
    const intakeUser = await makeUser('intake_specialist', 'Ivy Intake');
    const itUser = await makeUser('it_admin', 'Indy IT');
    const intake = await signIn(app, intakeUser);
    expect((await intake.get(`/portal/messages/${generalId}`)).status).toBe(404);

    // Someone with no inbox access can't be given one.
    await post(admin, `/portal/messages/${generalId}`, `/portal/messages/${generalId}/assign`, { assigned_to: itUser.id });
    expect((await db('contact_messages').where({ id: generalId }).first()).assigned_to).toBeNull();

    await post(admin, `/portal/messages/${generalId}`, `/portal/messages/${generalId}/assign`, { assigned_to: intakeUser.id });
    expect((await db('contact_messages').where({ id: generalId }).first()).assigned_to).toBe(intakeUser.id);
    expect(await db('notifications').where({ user_id: intakeUser.id }).first()).toMatchObject({ link: `/portal/messages/${generalId}` });
    expect((await intake.get(`/portal/messages/${generalId}`)).status).toBe(200);
    // ...and an email that says so, without the message itself.
    const mail = outbox.find((m) => m.to === intakeUser.email);
    expect(mail.subject).toMatch(/assigned you a message/);
    expect(mail.text).not.toContain('I have a question');
    expect((await intake.get('/portal/messages')).text).toContain('Pat Visitor');
  });
});

describe('inbox: archive and delete', () => {
  it('archives and permanently deletes with the right permissions', async () => {
    const id = await forCoordinator();
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
  it('alerts only the inbox owners (not Admin), linking to the message; CEO/COO alerts Admin', async () => {
    const admin = await makeUser('admin');
    const reception = await makeUser('reception');
    await makeUser('program_coordinator');
    await makeUser('program_director');
    const inquiries = require('../src/services/inquiries');
    const { id } = await inquiries.submitContact({ recipient: 'general', name: 'Web Visitor', email: 'web@example.com', phone: '', message: 'Hi there, a question.' }, { ip: '127.0.0.1' });
    expect(await db('notifications').pluck('user_id')).toEqual([reception.id]);
    expect((await db('notifications').first()).link).toBe(`/portal/messages/${id}`);

    await db('notifications').del();
    await inquiries.submitContact({ recipient: 'executive', name: 'Web Visitor', email: 'web@example.com', phone: '', message: 'For the CEO please.' }, { ip: '127.0.0.1' });
    expect(await db('notifications').pluck('user_id')).toEqual([admin.id]);
  });

  it('falls back to Admin when nobody active has the alerted role', async () => {
    const admin = await makeUser('admin');
    const inquiries = require('../src/services/inquiries');
    await inquiries.submitContact({ recipient: 'general', name: 'Web Visitor', email: 'web@example.com', phone: '', message: 'Anyone there?' }, { ip: '127.0.0.1' });
    expect(await db('notifications').pluck('user_id')).toEqual([admin.id]);
  });

  it('keeps referral details out of the team email', async () => {
    await makeUser('intake_specialist');
    const inquiries = require('../src/services/inquiries');
    await inquiries.submitReferral({
      referrer_name: 'Casey Agency', referrer_email: 'casey@agency.example', referrer_phone: '410-555-0123', referrer_role: 'ccs', organization: 'County CCS',
      person_name: 'J.E.', county: 'Howard County', dda_eligibility: 'eligible', services: ['personal-supports'], notes: 'Has seizures at night', consent: 'yes',
    }, { ip: '127.0.0.1' });
    const team = outbox.find((m) => m.subject.startsWith('New referral'));
    expect(team.text).toContain('Casey Agency');
    for (const secret of ['J.E.', 'Howard County', 'DDA', 'seizures']) expect(team.text).not.toContain(secret);
    expect(team.html).toContain('Open in the staff portal');
  });
});

describe('alerts: Roles & permissions', () => {
  it('lets the Admin choose who is alerted, only among roles that can see the item', async () => {
    const admin = await makeUser('admin');
    const director = await makeUser('program_director');
    const reception = await makeUser('reception');
    const agent = await signIn(app, admin);
    const page = (await agent.get('/portal/roles')).text;
    expect(page).toContain('Alerts for new website items');
    expect(page).toMatch(/name="alert_referral" value="intake_specialist"[^>]*checked/);

    // Director can see referrals, Reception can't (so that tick is ignored).
    await post(agent, '/portal/roles', '/portal/roles/alerts', { alert_referral: ['program_director', 'reception'] });
    const inquiries = require('../src/services/inquiries');
    await inquiries.submitReferral({
      referrer_name: 'Casey', referrer_email: 'casey@agency.example', referrer_phone: '410-555-0123', referrer_role: 'ccs',
      person_name: 'J.E.', county: 'Howard County', services: [], consent: 'yes',
    }, { ip: '127.0.0.1' });
    expect(await db('notifications').where({ type: 'referral' }).pluck('user_id')).toEqual([director.id]);
    expect(await db('notifications').where({ user_id: reception.id })).toHaveLength(0);
    expect(await db('audit_log').where({ action: 'alerts.update' }).first()).toBeTruthy();
  });

  it('only lets people who manage roles change alerts', async () => {
    const director = await signIn(app, await makeUser('program_director'));
    expect((await post(director, '/portal/messages', '/portal/roles/alerts', { alert_referral: 'program_director' })).status).toBe(403);
  });

  it('flags items that waited too long once, by alert and a short email', async () => {
    const admin = await makeUser('admin');
    const old = new Date(Date.now() - 10 * 86400000);
    await message({ created_at: old, message: 'Private details here' });
    await message(); // just arrived
    const alerts = require('../src/services/alerts');
    expect(await alerts.checkOverdue()).toBe(1);
    const n = await db('notifications').where({ type: 'overdue' });
    expect(n).toHaveLength(1);
    expect(n[0]).toMatchObject({ user_id: admin.id, link: '/portal' });
    const mail = outbox.find((m) => m.to === admin.email);
    expect(mail.text).toContain('1 contact form message');
    expect(mail.text).not.toContain('Private details');
    expect(await alerts.checkOverdue()).toBe(0);
  });
});
