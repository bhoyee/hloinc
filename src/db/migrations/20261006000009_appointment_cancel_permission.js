'use strict';

/**
 * Requirements §4: Program Directors, Program Coordinators and Intake
 * Specialists can confirm *and cancel* appointments. Cancelling is the
 * appointments "archive" permission, which the first role set missed.
 *
 * @param {import('knex').Knex} knex
 */
const ROLES = ['program_director', 'program_coordinator', 'intake_specialist'];

exports.up = async function up(knex) {
  const rows = await knex('roles').whereIn('key', ROLES).select('id');
  if (rows.length) {
    await knex('role_permissions')
      .insert(rows.map((r) => ({ role_id: r.id, permission: 'appointments.archive' })))
      .onConflict()
      .ignore();
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const ids = await knex('roles').whereIn('key', ROLES).pluck('id');
  await knex('role_permissions').whereIn('role_id', ids).where({ permission: 'appointments.archive' }).del();
};
