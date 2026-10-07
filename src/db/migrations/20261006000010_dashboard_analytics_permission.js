'use strict';

/**
 * Dashboard charts are their own permission ("Dashboard analytics → See
 * charts") so the CEO/COO decide who gets them. Admin has it automatically;
 * Program Directors start with it.
 *
 * @param {import('knex').Knex} knex
 */
const ROLES = ['program_director'];

exports.up = async function up(knex) {
  const rows = await knex('roles').whereIn('key', ROLES).select('id');
  if (rows.length) {
    await knex('role_permissions')
      .insert(rows.map((r) => ({ role_id: r.id, permission: 'reports.view' })))
      .onConflict()
      .ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where({ permission: 'reports.view' }).del();
};
