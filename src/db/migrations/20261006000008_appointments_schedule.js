'use strict';

/**
 * Phase 3: appointment management and staff schedules.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appointments', (t) => {
    t.integer('duration_minutes').unsigned().nullable().after('scheduled_at');
    t.integer('assigned_to').unsigned().nullable().after('duration_minutes').references('id').inTable('users').onDelete('SET NULL');
    // Internal notes, never shown to the visitor. `notes` is what the visitor wrote.
    t.text('staff_notes').nullable().after('notes');
    t.string('cancel_reason', 255).nullable().after('staff_notes');
    t.index(['status', 'scheduled_at']);
  });

  await knex.schema.createTable('shifts', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    // A working shift, or time off (leave, training, sickness) that blocks the person out.
    t.enum('kind', ['shift', 'time_off']).notNullable().defaultTo('shift');
    t.dateTime('start_at').notNullable();
    t.dateTime('end_at').notNullable();
    t.string('label', 80).nullable(); // e.g. "Office", "Community visits", "Annual leave"
    t.string('location', 120).nullable();
    t.string('notes', 500).nullable();
    t.integer('created_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamps(true, true);
    t.index(['user_id', 'start_at']);
    t.index(['start_at', 'end_at']);
  });

  // Program Directors manage the list of appointment types (Admin has every permission already).
  const director = await knex('roles').where({ key: 'program_director' }).first();
  if (director) {
    await knex('role_permissions').insert({ role_id: director.id, permission: 'appointments.manage_types' }).onConflict().ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where({ permission: 'appointments.manage_types' }).del();
  await knex.schema.dropTableIfExists('shifts');
  await knex.schema.alterTable('appointments', (t) => {
    t.dropIndex(['status', 'scheduled_at']);
    t.dropForeign('assigned_to');
    t.dropColumn('cancel_reason');
    t.dropColumn('staff_notes');
    t.dropColumn('assigned_to');
    t.dropColumn('duration_minutes');
  });
};
