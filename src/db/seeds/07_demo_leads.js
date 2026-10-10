'use strict';

/**
 * DEMO leads: links the demo submissions and appointments to leads (the same
 * way real ones are linked as they arrive), then gives them a realistic mix of
 * stages, owners and notes so the Leads page can be tried.
 *
 * Development, or a server with DEMO_DATA=true (src/db/demo.js). Only touches
 * demo rows (@example.com, 555-01xx) that are not linked yet, so it is safe to
 * run on every deploy.
 */
const demo = require('../demo');

const digitsOf = (phone) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
};
const isDemoPhone = (p) => /555-?01\d\d$/.test(String(p || '').replace(/\s/g, ''));

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;

  const messages = await knex('contact_messages').whereNull('lead_id').where('email', 'like', `%${demo.VISITOR_DOMAIN}`)
    .where((w) => w.whereNot('type', 'message').orWhereIn('recipient', ['intake', 'general']))
    .select('id', 'type', 'name', 'email', 'phone', 'details', 'status', 'created_at');
  const appointments = (await knex('appointments').whereNull('lead_id').select('id', 'name', 'email', 'phone', 'status', 'created_at'))
    .filter((a) => (a.email && a.email.endsWith(demo.VISITOR_DOMAIN)) || (!a.email && isDemoPhone(a.phone)));
  if (!messages.length && !appointments.length) return;

  const items = [
    ...messages.map((m) => ({ ...m, table: 'contact_messages', origin: m.type })),
    ...appointments.map((a) => ({ ...a, table: 'appointments', origin: 'appointment' })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at));

  const byKey = new Map();
  const touched = new Map(); // lead id -> { handled, done }
  for (const it of items) {
    let d = {};
    try {
      d = typeof it.details === 'string' ? JSON.parse(it.details) : it.details || {};
    } catch {
      d = {};
    }
    const email = it.email ? it.email.toLowerCase() : null;
    const digits = digitsOf(it.phone);
    const key = email ? `e:${email}` : digits ? `p:${digits}` : null;
    let leadId = it.origin !== 'referral' && key ? byKey.get(key) : null;
    if (!leadId) {
      const referral = it.origin === 'referral';
      [leadId] = await knex('leads').insert({
        origin: it.origin,
        name: referral ? d.person_name || 'Referred person' : it.name,
        email, phone: it.phone || null, phone_digits: digits,
        referred_by: referral ? [it.name, d.organization].filter(Boolean).join(', ') : null,
        county: d.county || null,
        services: Array.isArray(d.services) && d.services.length ? JSON.stringify(d.services) : null,
        last_activity_at: it.created_at, created_at: it.created_at, updated_at: it.created_at,
      });
      if (!referral && key) byKey.set(key, leadId);
    } else {
      await knex('leads').where({ id: leadId }).update({ last_activity_at: it.created_at });
    }
    await knex(it.table).where({ id: it.id }).update({ lead_id: leadId });
    const t = touched.get(leadId) || { handled: false, done: false };
    t.handled = t.handled || !['new', 'requested'].includes(it.status);
    t.done = t.done || ['resolved', 'completed'].includes(it.status);
    touched.set(leadId, t);
  }

  // Where each demo lead has got to, and who looks after it.
  const team = await knex('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`)
    .whereIn('role', ['intake_specialist', 'program_coordinator', 'program_director']).where({ status: 'active' }).select('id', 'name');
  const rand = demo.random(11);
  const pick = (list) => list[Math.floor(rand() * list.length)];
  const notes = ['Left a voicemail, will try again tomorrow.', 'Family wants a home visit first.', 'Waiting on DDA eligibility letter.',
    'Sent the intake packet by email.', 'Coordinator confirmed funding is in place.', 'Prefers calls after 3pm.'];
  for (const [leadId, t] of touched) {
    let stage = 'new';
    if (t.done) {
      const r = rand();
      stage = r < 0.3 ? 'client' : r < 0.55 ? 'intake' : r < 0.7 ? 'not_fit' : 'contacted';
    } else if (t.handled) stage = rand() < 0.6 ? 'contacted' : 'intake';
    const owner = stage !== 'new' && team.length && rand() < 0.75 ? pick(team) : null;
    await knex('leads').where({ id: leadId }).update({ stage, owner_id: owner ? owner.id : null });
    if (owner && rand() < 0.4) {
      const lead = await knex('leads').where({ id: leadId }).first('last_activity_at');
      await knex('lead_events').insert({ lead_id: leadId, user_id: owner.id, user_name: owner.name, kind: 'note', body: pick(notes), created_at: lead.last_activity_at });
    }
  }
};
