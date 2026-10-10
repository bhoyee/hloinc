'use strict';

/**
 * Announcements can be paused (hidden everywhere, dates unchanged) and resumed.
 * Deleting: staff delete their own posts (moved to "Deleted", which an Admin can
 * restore); only an Admin deletes permanently, restores, or deletes anyone's.
 * That is the announcements "delete" permission, so it is taken away from the
 * other starting roles (the Admin can give it back under Roles & permissions).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.dateTime('paused_at').nullable().after('ends_at');
  });
  const roleIds = await knex('roles').whereNot({ key: 'admin' }).pluck('id');
  if (roleIds.length) await knex('role_permissions').whereIn('role_id', roleIds).where({ permission: 'announcements.delete' }).del();
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.dropColumn('paused_at');
  });
  const director = await knex('roles').where({ key: 'program_director' }).first('id');
  if (director) await knex('role_permissions').insert({ role_id: director.id, permission: 'announcements.delete' }).onConflict().ignore();
};
