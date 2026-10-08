'use strict';

/**
 * Announcements manager (requirements §5.4): who last changed each one, an
 * optional "Learn more" link, and archiving (hidden everywhere, restorable).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.string('link_url', 500).nullable().after('body');
    t.string('link_label', 60).nullable().after('link_url');
    t.dateTime('archived_at').nullable().after('ends_at').index();
    t.integer('updated_by').unsigned().nullable().references('id').inTable('users').onDelete('SET NULL').after('created_by');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('announcements', (t) => {
    t.dropForeign('updated_by');
    t.dropColumn('updated_by');
    t.dropColumn('archived_at');
    t.dropColumn('link_label');
    t.dropColumn('link_url');
  });
};
