'use strict';

/**
 * Contacts inbox (requirements §5.5): who's handling each message, archiving,
 * and a history of internal notes, email replies and status changes.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('contact_messages', (t) => {
    t.integer('assigned_to').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL').after('status');
    t.dateTime('archived_at').nullable().after('email_status').index();
    t.index(['type', 'status']);
  });

  await knex.schema.createTable('contact_message_events', (t) => {
    t.bigIncrements('id').primary();
    t.integer('message_id').unsigned().notNullable().references('id').inTable('contact_messages').onDelete('CASCADE');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    // Kept so the history stays readable if the account is later removed.
    t.string('user_name', 120).nullable();
    t.enum('kind', ['note', 'reply', 'status', 'assign']).notNullable();
    t.text('body').nullable();
    t.enum('email_status', ['sent', 'failed']).nullable(); // replies only
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['message_id', 'id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('contact_message_events');
  await knex.schema.alterTable('contact_messages', (t) => {
    t.dropIndex(['type', 'status']);
    t.dropForeign('assigned_to');
    t.dropColumn('assigned_to');
    t.dropColumn('archived_at');
  });
};
