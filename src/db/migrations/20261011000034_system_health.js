'use strict';

/**
 * System health (Administration → System health):
 * - email_log: every email the portal tries to send, with the recipient masked,
 *   so failures (e.g. a changed SMTP password) show up. Kept 90 days.
 * - usage_counters: monthly counts, e.g. Cloudmersive scans against the plan's
 *   allowance, and virus scanner errors with the last one seen.
 * - IT Administrator can see the page and run its checks (Admin has everything).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.createTable('email_log', (t) => {
    t.increments('id').primary();
    t.string('recipient', 191).notNullable();
    t.string('subject', 200).notNullable();
    t.boolean('ok').notNullable();
    t.string('error', 255).nullable();
    t.timestamp('created_at').notNullable().defaultTo(knex.fn.now());
    t.index(['created_at']);
    t.index(['ok', 'created_at']);
  });
  await knex.schema.createTable('usage_counters', (t) => {
    t.string('key', 60).notNullable();
    t.string('period', 7).notNullable(); // "2026-10"
    t.integer('count').unsigned().notNullable().defaultTo(0);
    t.timestamp('last_at').nullable();
    t.string('last_detail', 255).nullable();
    t.primary(['key', 'period']);
  });
  const it = await knex('roles').where({ key: 'it_admin' }).first('id');
  if (it) {
    for (const permission of ['system.view', 'system.maintain']) {
      await knex('role_permissions').insert({ role_id: it.id, permission }).onConflict().ignore();
    }
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where('permission', 'like', 'system.%').del();
  await knex('site_settings').where({ key: 'health.alerted' }).del();
  await knex.schema.dropTableIfExists('usage_counters');
  await knex.schema.dropTableIfExists('email_log');
};
