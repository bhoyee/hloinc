'use strict';

/**
 * "Get help" in the staff portal: anyone can report a problem or ask a question.
 * Each request records where they were (page, browser, any error reference) and
 * may carry a screenshot (re-encoded, kept in storage/support). Replies and status
 * changes go in support_updates. IT Administrator and Admin deal with them.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('support_requests', (t) => {
    t.increments('id').primary();
    t.string('reference', 20).notNullable().unique();
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('user_name', 120).notNullable(); // kept if the account is later removed
    t.enu('category', ['broken', 'howto', 'access', 'suggestion']).notNullable();
    t.text('message').notNullable();
    t.string('page_url', 300).nullable();
    t.string('browser', 120).nullable();
    t.string('screen', 20).nullable();
    t.string('error_ref', 20).nullable();
    t.string('screenshot', 64).nullable();
    t.enu('status', ['open', 'in_progress', 'fixed']).notNullable().defaultTo('open');
    t.integer('handled_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.timestamp('forwarded_at').nullable();
    t.timestamp('fixed_at').nullable();
    t.timestamps(true, true);
    t.index(['status', 'created_at']);
    t.index(['user_id', 'created_at']);
  });
  await knex.schema.createTable('support_updates', (t) => {
    t.increments('id').primary();
    t.integer('request_id').unsigned().notNullable().references('id').inTable('support_requests').onDelete('CASCADE');
    t.integer('user_id').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL');
    t.string('user_name', 120).notNullable();
    t.text('body').nullable();
    t.string('status', 20).nullable(); // the status it was changed to, if it changed
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['request_id', 'id']);
  });

  // IT Administrator deals with help requests (Admin has everything already).
  const it = await knex('roles').where({ key: 'it_admin' }).first('id');
  if (it) {
    for (const permission of ['support.view', 'support.edit']) {
      await knex('role_permissions').insert({ role_id: it.id, permission }).onConflict().ignore();
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where('permission', 'like', 'support.%').del();
  await knex('site_settings').where({ key: 'support.forward_email' }).del();
  await knex.schema.dropTableIfExists('support_updates');
  await knex.schema.dropTableIfExists('support_requests');
};
