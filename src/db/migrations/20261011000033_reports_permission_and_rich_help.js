'use strict';

/**
 * - Reports becomes its own area in Roles & permissions: "View the report" and
 *   "Download as PDF and CSV". Roles that had the monthly report keep both.
 * - Help requests and their replies keep the formatting from the editor.
 * - The developer email now comes from DEVELOPER_EMAIL in .env; the portal only
 *   switches automatic forwarding on or off.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  const had = await knex('role_permissions').where({ permission: 'reports.monthly' }).pluck('role_id');
  for (const roleId of had) {
    for (const permission of ['monthly_report.view', 'monthly_report.download']) {
      await knex('role_permissions').insert({ role_id: roleId, permission }).onConflict().ignore();
    }
  }
  await knex('role_permissions').where({ permission: 'reports.monthly' }).del();

  await knex.schema.alterTable('support_requests', (t) => {
    t.text('message_html').nullable();
  });
  await knex.schema.alterTable('support_updates', (t) => {
    t.text('body_html').nullable();
  });
  await knex('site_settings').where({ key: 'support.forward_email' }).del();
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  const had = await knex('role_permissions').where({ permission: 'monthly_report.view' }).pluck('role_id');
  for (const roleId of had) await knex('role_permissions').insert({ role_id: roleId, permission: 'reports.monthly' }).onConflict().ignore();
  await knex('role_permissions').where('permission', 'like', 'monthly_report.%').del();
  await knex.schema.alterTable('support_updates', (t) => t.dropColumn('body_html'));
  await knex.schema.alterTable('support_requests', (t) => t.dropColumn('message_html'));
  await knex('site_settings').where({ key: 'support.forward' }).del();
};
