'use strict';

/**
 * Referrals share the contact inbox (requirements §4: Intake Specialist sees
 * "intake and referral"). `type` tells them apart; `details` holds the
 * referral-specific fields.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.schema.alterTable('contact_messages', (t) => {
    t.enum('type', ['message', 'referral']).notNullable().defaultTo('message').after('id').index();
    t.json('details').nullable().after('message');
  });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex.schema.alterTable('contact_messages', (t) => {
    t.dropColumn('details');
    t.dropColumn('type');
  });
};
