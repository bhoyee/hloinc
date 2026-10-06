'use strict';

const { DEFAULT_ROLES } = require('../../auth/permissions');

/**
 * Roles become data (managed by the CEO/COO in the portal), and staff get
 * in-app notifications.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('roles', (t) => {
    t.increments('id').primary();
    t.string('key', 40).notNullable().unique();
    t.string('name', 80).notNullable();
    t.string('description', 255).nullable();
    // System roles (Admin) can't be edited or deleted, so HLO can never lock itself out.
    t.boolean('is_system').notNullable().defaultTo(false);
    t.boolean('require_mfa').notNullable().defaultTo(false);
    t.timestamps(true, true);
  });

  await knex.schema.createTable('role_permissions', (t) => {
    t.integer('role_id').unsigned().notNullable().references('id').inTable('roles').onDelete('CASCADE');
    t.string('permission', 80).notNullable();
    t.primary(['role_id', 'permission']);
  });

  for (const role of DEFAULT_ROLES) {
    const [id] = await knex('roles').insert({
      key: role.key,
      name: role.name,
      description: role.description,
      is_system: Boolean(role.is_system),
      require_mfa: Boolean(role.require_mfa),
    });
    await knex('role_permissions').insert(role.permissions.map((permission) => ({ role_id: id, permission })));
  }

  // Every user's role must exist; a role in use can't be deleted.
  await knex.schema.alterTable('users', (t) => {
    t.foreign('role').references('key').inTable('roles').onUpdate('CASCADE').onDelete('RESTRICT');
  });

  await knex.schema.createTable('notifications', (t) => {
    t.bigIncrements('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('type', 40).notNullable();
    t.string('title', 160).notNullable();
    t.string('body', 500).nullable();
    t.string('link', 255).nullable();
    t.dateTime('read_at').nullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'read_at']);
    t.index(['user_id', 'created_at']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('notifications');
  await knex.schema.alterTable('users', (t) => t.dropForeign('role'));
  await knex.schema.dropTableIfExists('role_permissions');
  await knex.schema.dropTableIfExists('roles');
};
