'use strict';

/**
 * Whose schedules each role can see (and, with "edit", change):
 *   { "mode": "all" }                        everyone
 *   { "mode": "own" }                        only their own
 *   { "mode": "roles", "roles": ["..."] }    their own plus people in these roles
 * The CEO/COO (Admin) always sees everyone. Set under Roles & permissions.
 *
 * @param {import('knex').Knex} knex
 */
const DEFAULTS = {
  admin: { mode: 'all' },
  it_admin: { mode: 'own' },
  program_director: { mode: 'roles', roles: ['program_coordinator', 'intake_specialist', 'reception'] },
  program_coordinator: { mode: 'roles', roles: ['intake_specialist', 'reception'] },
  intake_specialist: { mode: 'own' },
  reception: { mode: 'own' },
};

exports.up = async function up(knex) {
  await knex.schema.alterTable('roles', (t) => {
    t.string('schedule_scope', 2000).nullable().after('require_mfa');
  });
  for (const [key, scope] of Object.entries(DEFAULTS)) {
    await knex('roles').where({ key }).update({ schedule_scope: JSON.stringify(scope) });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('roles', (t) => t.dropColumn('schedule_scope'));
};
