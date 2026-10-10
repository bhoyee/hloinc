import { describe, it, expect, beforeEach, afterAll } from 'vitest';
import { createApp, db } from './helpers.js';
import { resetRoles, makeUser, signIn, post } from './portal-helpers.js';

const app = createApp();

async function message(over = {}) {
  const [id] = await db('contact_messages').insert({ type: 'message', recipient: 'general', name: 'Pat Visitor', email: 'pat@example.com', message: 'Hello there', email_status: 'sent', ...over });
  return id;
}

const badge = (html, key) => {
  const m = html.match(new RegExp(`data-nav-badge="${key}"[^>]*>([^<]*)<`));
  return m ? m[1].trim() : null;
};
const summary = async (agent) => (await agent.get('/portal/notifications/summary').set('Accept', 'application/json')).body.badges;

let typeId;
beforeEach(async () => {
  await db('notifications').del();
  await db('audit_log').del();
  await db('message_reads').del();
  await db('contact_message_events').del();
  await db('contact_messages').del();
  await db('appointments').del();
  await db('users').del();
  await db('appointment_types').del();
  [typeId] = await db('appointment_types').insert({ name: 'Intake consultation', duration_minutes: 60, capacity: 1, active: true, sort_order: 1 });
  await resetRoles();
});

afterAll(() => db.destroy());

describe('menu counters', () => {
  it('shows unread messages and waiting requests on the menu', async () => {
    await message();
    await message({ name: 'Second' });
    await db('appointments').insert([
      { type_id: typeId, source: 'website', status: 'requested', name: 'A', email: 'a@example.com' },
      { type_id: typeId, source: 'website', status: 'confirmed', name: 'B', email: 'b@example.com' },
    ]);
    const admin = await signIn(app, await makeUser('admin'));
    const html = (await admin.get('/portal')).text;
    expect(badge(html, 'messages')).toBe('2');
    expect(badge(html, 'appointments')).toBe('1');
    expect(await summary(admin)).toEqual({ messages: 2, appointments: 1, timeOff: 0 });
  });

  it('counts messages per person: opening one lowers only your own count', async () => {
    const id = await message();
    await message({ name: 'Second' });
    const one = await signIn(app, await makeUser('admin'));
    const two = await signIn(app, await makeUser('reception')); // General inquiry inbox
    const opened = await one.get(`/portal/messages/${id}`);
    expect(badge(opened.text, 'messages')).toBe('1'); // already lower on the message page itself
    expect((await summary(one)).messages).toBe(1);
    expect((await summary(two)).messages).toBe(2);
    expect((await one.get('/portal/messages?tab=all')).text).toContain('(unread)');
  });

  it('drops for everyone when a message is resolved or archived', async () => {
    const id = await message();
    const coordinator = await signIn(app, await makeUser('admin'));
    const other = await signIn(app, await makeUser('reception'));
    expect((await summary(other)).messages).toBe(1);
    await post(coordinator, `/portal/messages/${id}`, `/portal/messages/${id}/status`, { status: 'resolved' });
    expect((await summary(other)).messages).toBe(0);
  });

  it('drops the appointment counter when a request is confirmed or cancelled', async () => {
    const [id] = await db('appointments').insert({ type_id: typeId, source: 'website', status: 'requested', name: 'A', email: 'a@example.com' });
    const director = await signIn(app, await makeUser('program_director'));
    expect((await summary(director)).appointments).toBe(1);
    await post(director, `/portal/appointments/${id}`, `/portal/appointments/${id}/cancel`, { reason: 'Duplicate' });
    expect((await summary(director)).appointments).toBe(0);
  });

  it('only counts what the role can see', async () => {
    await message(); // general inbox
    await message({ recipient: 'intake', name: 'Intake person' });
    const intake = await signIn(app, await makeUser('intake_specialist'));
    expect((await summary(intake)).messages).toBe(1);

    const it_ = await signIn(app, await makeUser('it_admin'));
    expect(await summary(it_)).toEqual({ messages: null, appointments: null, timeOff: null });
    expect((await it_.get('/portal/accounts')).text).not.toContain('data-nav-badge="messages"');
  });

  it('marks everything as read', async () => {
    await message();
    await message({ name: 'Second' });
    const admin = await signIn(app, await makeUser('admin'));
    await post(admin, '/portal/messages', '/portal/messages/read-all', { back: '/portal/messages' });
    expect((await summary(admin)).messages).toBe(0);
  });
});
