'use strict';

/**
 * "Request services" form (from HLO's site plan, October 2026): requests from
 * individuals and families go into the same inbox as messages and referrals,
 * as a third type.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE contact_messages MODIFY type ENUM('message','referral','request') NOT NULL DEFAULT 'message'");
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('contact_messages').where({ type: 'request' }).update({ type: 'referral' });
  await knex.raw("ALTER TABLE contact_messages MODIFY type ENUM('message','referral') NOT NULL DEFAULT 'message'");
};
