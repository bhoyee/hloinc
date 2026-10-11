'use strict';

/**
 * Staff announcements as a banner across the portal:
 *  - priority: "important" (red banner, can't be dismissed, bell alert to all staff
 *    when it goes live) or "normal" (green banner, each person can dismiss it);
 *  - notified_at: when staff were alerted, so it happens once (also for scheduled ones);
 *  - announcement_dismissals: who closed which banner. Editing an announcement brings
 *    it back (it's newer than the dismissal).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.enu('priority', ['normal', 'important']).notNullable().defaultTo('normal');
    t.timestamp('notified_at').nullable();
  });
  // Existing announcements were already announced the old way.
  await knex('announcements').update({ notified_at: knex.fn.now() });
  await knex.schema.createTable('announcement_dismissals', (t) => {
    t.integer('announcement_id').unsigned().notNullable().references('id').inTable('announcements').onDelete('CASCADE');
    t.integer('user_id').unsigned().notNullable().references('id').inTable('users').onDelete('CASCADE');
    t.timestamp('dismissed_at').notNullable().defaultTo(knex.fn.now());
    t.primary(['announcement_id', 'user_id']);
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.dropTableIfExists('announcement_dismissals');
  await knex.schema.alterTable('announcements', (t) => {
    t.dropColumn('priority');
    t.dropColumn('notified_at');
  });
};
