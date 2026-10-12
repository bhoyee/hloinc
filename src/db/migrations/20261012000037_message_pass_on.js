'use strict';

/**
 * - New permission "Send messages on to another team" (messages.pass_on): Reception
 *   and every role that can reply to messages get it.
 * - Message history: "passed on" (reception sends a contact message to another
 * team's inbox with "Send to…") and "meeting" (a meeting booked from it).
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  await knex.raw("ALTER TABLE contact_message_events MODIFY kind ENUM('note', 'reply', 'status', 'assign', 'passed_on', 'meeting') NOT NULL");
  const roleIds = new Set([
    ...(await knex('role_permissions').where({ permission: 'messages.edit' }).pluck('role_id')),
    ...(await knex('roles').whereIn('key', ['admin', 'reception']).pluck('id')),
  ]);
  for (const roleId of roleIds) {
    await knex('role_permissions').insert({ role_id: roleId, permission: 'messages.pass_on' }).onConflict().ignore();
  }
  await knex('roles').where({ key: 'reception' }).update({ description: 'Front desk: logs walk-in and phone appointments; read-only schedules; reads contact page messages and sends them on to the right team.' });
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  await knex('role_permissions').where({ permission: 'messages.pass_on' }).del();
  await knex('contact_message_events').whereIn('kind', ['passed_on', 'meeting']).update({ kind: 'note' });
  await knex.raw("ALTER TABLE contact_message_events MODIFY kind ENUM('note', 'reply', 'status', 'assign') NOT NULL");
};
