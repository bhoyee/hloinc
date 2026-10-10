'use strict';

/**
 * Time-off requests: any staff member asks for time off; someone who manages
 * their schedule approves or declines it. Approving adds the time off to the
 * schedule (shift_id points at that entry).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('time_off_requests', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enum('reason', ['vacation', 'sick', 'personal', 'training', 'other']).notNullable();
    t.dateTime('start_at').notNullable();
    t.dateTime('end_at').notNullable();
    t.boolean('all_day').notNullable().defaultTo(true);
    t.string('notes', 1000).nullable();
    t.enum('status', ['pending', 'approved', 'declined', 'cancelled']).notNullable().defaultTo('pending').index();
    t.integer('decided_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('decided_by_name', 120).nullable(); // kept readable if the account is later removed
    t.dateTime('decided_at').nullable();
    t.string('decision_note', 500).nullable();
    t.integer('shift_id').unsigned().nullable().references('id').inTable('shifts').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['user_id', 'status']);
    t.index(['start_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTable('time_off_requests');
};
