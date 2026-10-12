'use strict';

/**
 * The Careers page (HLO's design, version 20) asks applicants for a phone number
 * and a cell number.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('job_applications', (t) => {
    t.string('cell', 30).nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('job_applications', (t) => t.dropColumn('cell'));
};
