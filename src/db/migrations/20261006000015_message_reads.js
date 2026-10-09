'use strict';

/**
 * Which staff member has opened which message, for the unread badge on
 * "Messages" in the portal menu. Each person has their own unread count.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('message_reads', (t) => {
    t.integer('message_id').unsigned().notNullable().references('id').inTable('contact_messages').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.dateTime('read_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['message_id', 'user_id']);
    t.index(['user_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('message_reads');
};
