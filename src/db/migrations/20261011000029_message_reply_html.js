'use strict';

/**
 * Replies written in the formatted editor keep their formatting (cleaned HTML),
 * so the history shows them as sent. `body` keeps the plain-text version.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('contact_message_events', (t) => {
    t.text('body_html').nullable();
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('contact_message_events', (t) => {
    t.dropColumn('body_html');
  });
};
