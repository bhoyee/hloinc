'use strict';

/**
 * Announcements: only Admin manages them by default. Creating/editing, pausing,
 * ending early and deleting are separate permissions the Admin can give to any
 * role (Roles & permissions). Every other role keeps "View" (staff see the
 * staff board and banner either way).
 *
 * @param {import('knex').Knex} knex
 */
const MANAGE = ['announcements.edit', 'announcements.archive', 'announcements.delete', 'announcements.pause', 'announcements.end'];

exports.up = async function up(knex) {
  const admin = await knex('roles').where({ key: 'admin' }).first('id');
  await knex('role_permissions')
    .whereIn('permission', MANAGE)
    .modify((q) => admin && q.whereNot({ role_id: admin.id }))
    .del();
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  // Back to the old starting roles: Program Director and Coordinator could create, edit and delete their own.
  for (const key of ['program_director', 'program_coordinator']) {
    const role = await knex('roles').where({ key }).first('id');
    if (!role) continue;
    for (const permission of ['announcements.edit', 'announcements.archive']) {
      await knex('role_permissions').insert({ role_id: role.id, permission }).onConflict().ignore();
    }
  }
};
