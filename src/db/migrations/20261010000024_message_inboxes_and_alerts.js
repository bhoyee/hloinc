'use strict';

/**
 * Messages: only Admin sees every message by default. Every other role sees the
 * inboxes ticked for it (one permission per contact form choice; Intake also
 * covers referrals and service requests) plus anything assigned to its people.
 * Replaces "view_intake". Also records when an item was flagged to managers as
 * waiting too long, so it's only flagged once.
 *
 * @param {import('knex').Knex} knex
 */
const STARTING = {
  program_director: ['messages.inbox_program_director', 'messages.inbox_intake'],
  program_coordinator: ['messages.inbox_program_coordinator'],
  reception: ['messages.inbox_general'],
};

const add = (knex, roleId, permissions) =>
  Promise.all(permissions.map((permission) => knex('role_permissions').insert({ role_id: roleId, permission }).onConflict().ignore()));

exports.up = async function up(knex) {
  for (const id of await knex('role_permissions').where({ permission: 'messages.view_intake' }).pluck('role_id')) await add(knex, id, ['messages.inbox_intake']);
  await knex('role_permissions').where({ permission: 'messages.view_intake' }).del();
  for (const [key, permissions] of Object.entries(STARTING)) {
    const role = await knex('roles').where({ key }).first();
    if (!role || !(await knex('role_permissions').where({ role_id: role.id, permission: 'messages.view' }).first())) continue;
    await knex('role_permissions').where({ role_id: role.id, permission: 'messages.view' }).del();
    await add(knex, role.id, permissions);
  }
  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => t.timestamp('escalated_at').nullable());
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => t.dropColumn('escalated_at'));
  }
  for (const [key, permissions] of Object.entries(STARTING)) {
    const role = await knex('roles').where({ key }).first();
    if (role && (await knex('role_permissions').where({ role_id: role.id }).whereIn('permission', permissions).first())) {
      await add(knex, role.id, ['messages.view']);
      await knex('role_permissions').where({ role_id: role.id }).where('permission', 'like', 'messages.inbox_%').del();
    }
  }
  for (const id of await knex('role_permissions').where({ permission: 'messages.inbox_intake' }).pluck('role_id')) await add(knex, id, ['messages.view_intake']);
  await knex('role_permissions').where('permission', 'like', 'messages.inbox_%').del();
};
