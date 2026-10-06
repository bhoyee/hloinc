'use strict';

const { DEFAULT_ROLES } = require('../../auth/permissions');

/**
 * Adds the IT Administrator role to databases created before it existed.
 * (New databases already get it from the roles migration.)
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const role = DEFAULT_ROLES.find((r) => r.key === 'it_admin');
  if (await knex('roles').where({ key: role.key }).first()) return;
  const [id] = await knex('roles').insert({
    key: role.key,
    name: role.name,
    description: role.description,
    require_mfa: role.require_mfa,
  });
  await knex('role_permissions').insert(role.permissions.map((permission) => ({ role_id: id, permission })));
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const inUse = await knex('users').where({ role: 'it_admin' }).first();
  if (inUse) throw new Error('Move staff off the IT Administrator role before rolling back.');
  await knex('roles').where({ key: 'it_admin' }).del();
};
