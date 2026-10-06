'use strict';

/**
 * Maryland's Wage Range Transparency Act (effective Oct 1, 2024) requires
 * public job postings to show the pay range and a general description of
 * benefits, so jobs get fields for both.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.string('pay_range', 120).nullable().after('employment_type');
    t.text('benefits').nullable().after('requirements');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('jobs', (t) => {
    t.dropColumn('benefits');
    t.dropColumn('pay_range');
  });
};
