'use strict';

/**
 * Two-step sign-in starts OFF on a new installation: staff sign in with email
 * and password, and the CEO/COO can switch two-step on for everyone under
 * Administration → Security settings. If someone has already chosen a setting,
 * it is left as it is.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const existing = await knex('site_settings').where({ key: 'security.two_step' }).first();
  if (!existing) await knex('site_settings').insert({ key: 'security.two_step', value: JSON.stringify(false), updated_at: knex.fn.now() });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down() {
  // Leave the setting as it is: undoing must never quietly change portal security.
};
