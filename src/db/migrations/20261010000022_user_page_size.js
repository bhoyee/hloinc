'use strict';

/**
 * Each staff member's "rows per page" choice for portal lists (10, 25, 50 or
 * 100), saved on their account so it follows them across devices.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.tinyint('page_size').unsigned().nullable().after('last_login_at');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('page_size');
  });
};
