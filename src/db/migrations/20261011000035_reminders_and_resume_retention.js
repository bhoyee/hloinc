'use strict';

/**
 * - Appointment reminders: one email the day before. `reminder_for` is the
 *   appointment time the reminder was about, so a rescheduled appointment gets
 *   a new reminder; failed sends are retried up to three times.
 * - Resumes are deleted automatically after 3 months (RESUME_KEEP_DAYS); the
 *   application itself stays, with the date its resume was removed.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('appointments', (t) => {
    t.timestamp('reminder_for').nullable();
    t.timestamp('reminder_at').nullable();
    t.string('reminder_status', 10).nullable(); // sent | failed
    t.tinyint('reminder_attempts').unsigned().notNullable().defaultTo(0);
  });
  await knex.schema.alterTable('job_applications', (t) => {
    t.timestamp('resume_deleted_at').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('job_applications', (t) => t.dropColumn('resume_deleted_at'));
  await knex.schema.alterTable('appointments', (t) => {
    t.dropColumn('reminder_attempts');
    t.dropColumn('reminder_status');
    t.dropColumn('reminder_at');
    t.dropColumn('reminder_for');
  });
};
