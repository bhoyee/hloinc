'use strict';

/** @param {import('knex').Knex} knex */
exports.up = async function up(knex) {
  await knex.schema.createTable('users', (t) => {
    t.increments('id').primary();
    t.string('name', 120).notNullable();
    t.string('email', 191).notNullable().unique();
    t.string('phone', 40).nullable();
    t.string('password_hash', 100).notNullable();
    t.string('role', 40).notNullable().index();
    t.enum('status', ['active', 'deactivated']).notNullable().defaultTo('active').index();
    t.boolean('mfa_enabled').notNullable().defaultTo(false);
    t.string('mfa_secret', 255).nullable();
    t.integer('failed_login_count').unsigned().notNullable().defaultTo(0);
    t.dateTime('locked_until').nullable();
    t.dateTime('last_login_at').nullable();
    t.dateTime('password_changed_at').nullable();
    t.dateTime('deactivated_at').nullable();
    t.timestamps(true, true);
  });

  await knex.schema.createTable('audit_log', (t) => {
    t.bigIncrements('id').primary();
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    // Kept so the log stays readable if the account is later removed.
    t.string('user_name', 120).nullable();
    t.string('action', 60).notNullable().index();
    t.string('entity_type', 60).nullable();
    t.string('entity_id', 64).nullable();
    t.string('summary', 500).nullable();
    t.string('ip', 64).nullable();
    t.string('user_agent', 255).nullable();
    t.json('metadata').nullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now()).index();
    t.index(['entity_type', 'entity_id']);
  });

  await knex.schema.createTable('site_settings', (t) => {
    t.string('key', 100).primary();
    t.json('value').notNullable();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.dateTime('updated_at').notNullable().defaultTo(knex.fn.now());
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('site_settings');
  await knex.schema.dropTableIfExists('audit_log');
  await knex.schema.dropTableIfExists('users');
};
