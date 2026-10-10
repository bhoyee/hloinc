'use strict';

/**
 * Leads: one record per person who has reached out, so staff can see everyone
 * in one list with what they sent, where they are in intake, and who owns them.
 *
 * - Families, website messages and appointments are matched to one lead by
 *   email, or phone when there is no email.
 * - Each referral is its own lead for the person referred (first name or
 *   initials), with the coordinator recorded as "referred by".
 *
 * Existing submissions are linked to leads here.
 *
 * @param {import('knex').Knex} knex
 */

const STAGES = ['new', 'contacted', 'intake', 'client', 'not_fit'];
// Contact form messages that are about starting services (not feedback to a director, etc.).
const LEAD_RECIPIENTS = ['intake', 'general'];
// Roles that work with intake get leads; Admin always has every permission.
const GRANTS = {
  program_director: ['leads.view', 'leads.edit', 'leads.export'],
  program_coordinator: ['leads.view', 'leads.edit'],
  intake_specialist: ['leads.view', 'leads.edit'],
};

const digitsOf = (phone) => {
  let d = String(phone || '').replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  return d.length === 10 ? d : null;
};

exports.up = async function up(knex) {
  await knex.schema.createTable('leads', (t) => {
    t.increments('id').primary();
    t.enum('origin', ['message', 'request', 'appointment', 'referral', 'manual']).notNullable();
    t.string('name', 120).notNullable();
    t.string('email', 191).nullable().index();
    t.string('phone', 40).nullable();
    t.string('phone_digits', 15).nullable().index();
    t.string('referred_by', 200).nullable(); // referrals: "Casey Coordinator, Example Agency"
    t.string('county', 80).nullable();
    t.json('services').nullable();
    t.enum('stage', STAGES).notNullable().defaultTo('new').index();
    t.integer('owner_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.dateTime('last_activity_at').notNullable().defaultTo(knex.fn.now()).index();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('lead_events', (t) => {
    t.bigIncrements('id').primary();
    t.integer('lead_id').unsigned().notNullable().references('id').inTable('leads').onDelete('CASCADE');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('user_name', 120).nullable();
    t.enum('kind', ['note', 'stage', 'owner', 'details']).notNullable();
    t.text('body').nullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['lead_id', 'id']);
  });

  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => {
      t.integer('lead_id').unsigned().nullable().references('id').inTable('leads').onDelete('SET NULL');
      t.index(['lead_id']);
    });
  }

  // Link what is already there, oldest first.
  const items = [
    ...(await knex('contact_messages').select('id', 'type', 'recipient', 'name', 'email', 'phone', 'details', 'status', 'created_at'))
      .filter((m) => m.type !== 'message' || LEAD_RECIPIENTS.includes(m.recipient))
      .map((m) => ({ ...m, table: 'contact_messages', origin: m.type, started: m.status !== 'new' })),
    ...(await knex('appointments').select('id', 'name', 'email', 'phone', 'status', 'created_at'))
      .map((a) => ({ ...a, table: 'appointments', origin: 'appointment', started: a.status !== 'requested' })),
  ].sort((a, b) => new Date(a.created_at) - new Date(b.created_at) || a.id - b.id);

  const byEmail = new Map();
  const byPhone = new Map();
  for (const it of items) {
    let details = {};
    try {
      details = typeof it.details === 'string' ? JSON.parse(it.details) : it.details || {};
    } catch {
      details = {};
    }
    const email = it.email ? String(it.email).toLowerCase() : null;
    const digits = digitsOf(it.phone);
    let leadId = null;
    if (it.origin !== 'referral') leadId = (email && byEmail.get(email)) || (!email && digits && byPhone.get(digits)) || null;

    if (!leadId) {
      const isReferral = it.origin === 'referral';
      [leadId] = await knex('leads').insert({
        origin: it.origin,
        name: isReferral ? details.person_name || 'Referred person' : it.name,
        email,
        phone: it.phone || null,
        phone_digits: digits,
        referred_by: isReferral ? [it.name, details.organization].filter(Boolean).join(', ') : null,
        county: details.county || null,
        services: Array.isArray(details.services) && details.services.length ? JSON.stringify(details.services) : null,
        stage: it.started ? 'contacted' : 'new',
        last_activity_at: it.created_at,
        created_at: it.created_at,
        updated_at: it.created_at,
      });
      if (!isReferral) {
        if (email) byEmail.set(email, leadId);
        else if (digits) byPhone.set(digits, leadId);
      }
    } else {
      const update = { last_activity_at: it.created_at };
      if (it.started) update.stage = knex.raw("IF(stage = 'new', 'contacted', stage)");
      await knex('leads').where({ id: leadId }).update(update);
    }
    await knex(it.table).where({ id: it.id }).update({ lead_id: leadId });
  }

  for (const [key, permissions] of Object.entries(GRANTS)) {
    const role = await knex('roles').where({ key }).first('id');
    if (role) await knex('role_permissions').insert(permissions.map((permission) => ({ role_id: role.id, permission }))).onConflict().ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where('permission', 'like', 'leads.%').del();
  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropForeign('lead_id');
      t.dropIndex(['lead_id']);
      t.dropColumn('lead_id');
    });
  }
  await knex.schema.dropTable('lead_events');
  await knex.schema.dropTable('leads');
};
