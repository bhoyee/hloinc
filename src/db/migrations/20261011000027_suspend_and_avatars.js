'use strict';

/**
 * Staff accounts: a "suspended" status (a temporary block that keeps everything,
 * separate from deactivating someone who has left), with who suspended them, when
 * and why; and a profile photo for each person.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE users MODIFY status ENUM('active', 'deactivated', 'suspended') NOT NULL DEFAULT 'active'");
  await knex.schema.alterTable('users', (t) => {
    t.timestamp('suspended_at').nullable();
    t.string('suspended_reason', 300).nullable();
    t.string('suspended_by_name', 120).nullable();
    // File name of the profile photo in storage/avatars (random, so it also busts caches).
    t.string('avatar', 40).nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('users').where({ status: 'suspended' }).update({ status: 'deactivated' });
  await knex.raw("ALTER TABLE users MODIFY status ENUM('active', 'deactivated') NOT NULL DEFAULT 'active'");
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('suspended_at');
    t.dropColumn('suspended_reason');
    t.dropColumn('suspended_by_name');
    t.dropColumn('avatar');
  });
};
