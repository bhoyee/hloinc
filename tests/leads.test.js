import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createRequire } from 'module';
import { createApp, db, formAgent } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const require = createRequire(import.meta.url);
const leads = require('../src/services/leads');
const spam = require('../src/lib/spam');

const app = createApp();

let typeId;
beforeEach(async () => {
  spam._reset();
  await db('notifications').del();
  await db('audit_log').del();
  await db('message_reads').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('appointments').del();
  await db('lead_events').del();
  await db('leads').del();
  await db('users').del();
  await db('appointment_types').del();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  await resetRoles();
});

afterAll(() => db.destroy());

const request_ = (over = {}) => ({
  first_name: 'Robin', last_name: 'Example', phone: '410-555-0144', email: 'robin@example.com', preferred_contact: 'email',
  best_time: 'morning', relationship: 'family', individual_first_name: 'Sam', county: 'Baltimore County',
  dda_eligibility: 'in_progress', pcp: 'not_sure', priority_category: '', services: ['respite-care'], message: '', consent: 'yes', ...over,
});
const referral = (over = {}) => ({
  referrer_name: 'Casey Coordinator', organization: 'Example Agency', referrer_role: 'ccs', referrer_phone: '410-555-0123',
  referrer_email: 'casey@agency.example', person_name: 'J.E.', county: 'Howard County', services: ['respite-care'], consent: 'yes', ...over,
});

async function submit(path, body) {
  const { agent, csrf } = await formAgent(app, path);
  return agent.post(path).type('form').send({ ...body, _csrf: csrf });
}

describe('leads are built from what people send', () => {
  it('keeps a family’s request and later contact message on one lead', async () => {
    await submit('/request-services', request_());
    await submit('/contact', { recipient: 'general', name: 'Robin Example', email: 'ROBIN@example.com', phone: '', message: 'One more question about respite.', consent: 'yes' });
    const all = await db('leads');
    expect(all).toHaveLength(1);
    expect(all[0]).toMatchObject({ origin: 'request', name: 'Robin Example', email: 'robin@example.com', county: 'Baltimore County', stage: 'new' });
    expect(await db('contact_messages').where({ lead_id: all[0].id })).toHaveLength(2);
  });

  it('gives each referral its own lead for the person referred', async () => {
    await submit('/referrals', referral());
    await submit('/referrals', referral({ person_name: 'A.B.' }));
    const all = await db('leads').orderBy('id');
    expect(all.map((l) => l.name)).toEqual(['J.E.', 'A.B.']);
    expect(all[0]).toMatchObject({ origin: 'referral', referred_by: 'Casey Coordinator, Example Agency', county: 'Howard County' });
  });

  it('does not turn feedback to a director into a lead', async () => {
    await submit('/contact', { recipient: 'program_director', name: 'Pat', email: 'pat@example.com', phone: '', message: 'Feedback about the program.', consent: 'yes' });
    expect(await db('leads')).toHaveLength(0);
  });

  it('matches by phone when there is no email, and reopens a closed lead that comes back', async () => {
    const first = await leads.attachAppointment((await db('appointments').insert({ type_id: typeId, source: 'phone', status: 'confirmed', name: 'Sam Caller', phone: '(410) 555-0177' }))[0], { name: 'Sam Caller', phone: '(410) 555-0177' }, { byStaff: true });
    expect((await db('leads').where({ id: first }).first()).stage).toBe('contacted');
    await db('leads').where({ id: first }).update({ stage: 'not_fit' });
    const again = await leads.attachAppointment((await db('appointments').insert({ type_id: typeId, source: 'walk_in', status: 'confirmed', name: 'Sam', phone: '410.555.0177' }))[0], { name: 'Sam', phone: '410.555.0177' });
    expect(again).toBe(first);
    expect((await db('leads').where({ id: first }).first()).stage).toBe('new');
  });

  it('moves a new lead to Contacted when staff respond', async () => {
    await submit('/request-services', request_());
    const [msg] = await db('contact_messages');
    const agent = await signIn(app, await makeUser('admin'));
    await post(agent, `/portal/messages/${msg.id}`, `/portal/messages/${msg.id}/status`, { status: 'in_progress' });
    expect((await db('leads').first()).stage).toBe('contacted');
  });
});

describe('the leads pages', () => {
  it('lists leads with how they came in, and finds them by reference', async () => {
    await submit('/request-services', request_());
    const [msg] = await db('contact_messages');
    const agent = await signIn(app, await makeUser('admin'));
    const page = await agent.get('/portal/leads');
    expect(page.status).toBe(200);
    expect(page.text).toContain('Robin Example');
    expect(page.text).toContain('Request');
    const found = await agent.get(`/portal/leads?q=${encodeURIComponent(msg.reference.toLowerCase())}`);
    expect(found.text).toContain('Robin Example');
    expect((await agent.get('/portal/leads?q=nobody-like-this')).text).toContain('Nothing matches those filters');
  });

  it('lets staff set the stage, owner, details and notes, and records each change', async () => {
    await submit('/request-services', request_());
    const lead = await db('leads').first();
    const coordinator = await makeUser('program_coordinator', 'Casey Coordinator');
    const agent = await signIn(app, await makeUser('admin'));
    const page = `/portal/leads/${lead.id}`;

    await post(agent, page, `${page}/stage`, { stage: 'intake' });
    await post(agent, page, `${page}/owner`, { owner_id: String(coordinator.id) });
    await post(agent, page, `${page}/note`, { note: 'Left a voicemail.' });
    await post(agent, page, `${page}/details`, { name: 'Robin Example', email: 'robin@example.com', phone: '4105550199', county: 'Howard County' });

    const after = await db('leads').where({ id: lead.id }).first();
    expect(after).toMatchObject({ stage: 'intake', owner_id: coordinator.id, phone: '410-555-0199', county: 'Howard County' });
    const view = (await agent.get(page)).text;
    for (const t of ['Left a voicemail.', 'Stage changed from New to Intake in progress.', 'Assigned to Casey Coordinator.']) expect(view).toContain(t);
    const actions = (await db('audit_log').pluck('action'));
    expect(actions).toEqual(expect.arrayContaining(['lead.view', 'lead.stage', 'lead.owner', 'lead.note', 'lead.details']));
    expect(await db('notifications').where({ user_id: coordinator.id })).toHaveLength(1);
  });

  it('only lets owners be people who work on leads', async () => {
    await submit('/request-services', request_());
    const lead = await db('leads').first();
    const reception = await makeUser('reception');
    const agent = await signIn(app, await makeUser('admin'));
    await post(agent, `/portal/leads/${lead.id}`, `/portal/leads/${lead.id}/owner`, { owner_id: String(reception.id) });
    expect((await db('leads').first()).owner_id).toBeNull();
  });

  it('exports a spreadsheet that cannot run formulas, and records the export', async () => {
    await submit('/contact', { recipient: 'general', name: '=HYPERLINK("http://evil")', email: 'x@example.com', phone: '', message: 'Hello there, a question.', consent: 'yes' });
    const agent = await signIn(app, await makeUser('admin'));
    const res = await agent.get('/portal/leads/export.csv?tab=all');
    expect(res.status).toBe(200);
    expect(res.headers['content-type']).toContain('text/csv');
    expect(res.text).toContain(`"'=HYPERLINK(""http://evil"")"`);
    expect(await db('audit_log').where({ action: 'leads.export' })).toHaveLength(1);
  });
});

describe('who can see leads', () => {
  it('follows the role permissions', async () => {
    const reception = await signIn(app, await makeUser('reception'));
    expect((await reception.get('/portal/leads')).status).toBe(403);
    expect((await reception.get('/portal')).text).not.toContain('href="/portal/leads"');

    const intake = await signIn(app, await makeUser('intake_specialist'));
    expect((await intake.get('/portal/leads')).status).toBe(200);
    expect((await intake.get('/portal/leads/export.csv')).status).toBe(403); // export is a separate permission

    const director = await signIn(app, await makeUser('program_director'));
    expect((await director.get('/portal/leads/export.csv')).status).toBe(200);
  });

  it('hides message text from the timeline when it is outside the person’s inbox', async () => {
    await submit('/contact', { recipient: 'general', name: 'Robin Example', email: 'robin@example.com', phone: '', message: 'Private general enquiry text.', consent: 'yes' });
    const lead = await db('leads').first();
    const intake = await signIn(app, await makeUser('intake_specialist'));
    const page = (await intake.get(`/portal/leads/${lead.id}`)).text;
    expect(page).not.toContain('Private general enquiry text.');
    expect(page).toContain('Sent to an inbox you can’t open.');
  });
});
