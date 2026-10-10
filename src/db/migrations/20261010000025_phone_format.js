'use strict';

/**
 * Phone numbers in the standard US format, (410) 555-0123, everywhere they are
 * stored (they used to be saved as 410-555-0123). Matching uses the digits, so
 * nothing else changes.
 *
 * @param {import('knex').Knex} knex
 */
const TABLES = ['appointments', 'contact_messages', 'leads', 'users'];

function convert(value, to) {
  if (typeof value !== 'string') return value;
  let d = value.replace(/\D/g, '');
  if (d.length === 11 && d.startsWith('1')) d = d.slice(1);
  if (d.length !== 10) return value;
  return to === 'us' ? `(${d.slice(0, 3)}) ${d.slice(3, 6)}-${d.slice(6)}` : `${d.slice(0, 3)}-${d.slice(3, 6)}-${d.slice(6)}`;
}

async function run(knex, to) {
  for (const table of TABLES) {
    const rows = await knex(table).whereNotNull('phone').select('id', 'phone');
    for (const r of rows) {
      const next = convert(r.phone, to);
      if (next !== r.phone) await knex(table).where({ id: r.id }).update({ phone: next });
    }
  }
  const setting = await knex('site_settings').where({ key: 'business.phone' }).first();
  if (setting) {
    const next = convert(JSON.parse(setting.value), to);
    await knex('site_settings').where({ key: 'business.phone' }).update({ value: JSON.stringify(next) });
  }
}

exports.up = (knex) => run(knex, 'us');
exports.down = (knex) => run(knex, 'dashes');
