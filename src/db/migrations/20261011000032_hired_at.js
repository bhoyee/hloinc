'use strict';

/**
 * When an application was marked Hired, for the monthly report's "Hires".
 * Existing hires take the date they were last updated.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('job_applications', (t) => {
    t.timestamp('hired_at').nullable();
    t.index(['hired_at']);
  });
  await knex('job_applications').where({ status: 'hired' }).update({ hired_at: knex.ref('updated_at') });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('job_applications', (t) => {
    t.dropIndex(['hired_at']);
    t.dropColumn('hired_at');
  });
};
