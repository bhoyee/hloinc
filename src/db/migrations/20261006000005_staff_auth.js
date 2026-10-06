'use strict';

/**
 * Phase 2: staff sign-in, password resets and MFA.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('users', (t) => {
    // Bumping this signs the user out everywhere (sessions store the version they started with).
    t.integer('session_version').unsigned().notNullable().defaultTo(1).after('status');
    // Set when an admin creates the account or resets access; cleared once the user sets their own password.
    t.boolean('must_change_password').notNullable().defaultTo(false).after('password_hash');
    // TOTP replay protection: the last 30-second step a code was accepted for.
    t.bigInteger('mfa_last_step').nullable().after('mfa_secret');
  });

  // One-time links for invitations and "forgot password". Only a hash of the token is stored.
  await knex.schema.createTable('password_tokens', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.enum('purpose', ['invite', 'reset']).notNullable();
    t.string('token_hash', 64).notNullable().unique();
    t.dateTime('expires_at').notNullable();
    t.dateTime('used_at').nullable();
    t.string('created_ip', 64).nullable();
    t.dateTime('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['user_id', 'purpose']);
  });

  // Single-use backup codes for when a staff member can't use their authenticator app.
  await knex.schema.createTable('mfa_recovery_codes', (t) => {
    t.increments('id').primary();
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.string('code_hash', 64).notNullable();
    t.dateTime('used_at').nullable();
    t.index(['user_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('mfa_recovery_codes');
  await knex.schema.dropTableIfExists('password_tokens');
  await knex.schema.alterTable('users', (t) => {
    t.dropColumn('mfa_last_step');
    t.dropColumn('must_change_password');
    t.dropColumn('session_version');
  });
};
