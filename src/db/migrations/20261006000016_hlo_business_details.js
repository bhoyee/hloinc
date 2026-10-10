'use strict';

/**
 * HLO confirmed their address, ZIP code and hours (October 2026). Update the
 * stored business details, but only where they still hold the old starting
 * values — anything already changed in the portal is left alone.
 *
 * @param {import('knex').Knex} knex
 */
const OLD_HOURS = 'Monday to Friday, 9 a.m. to 5 p.m.';
const NEW_HOURS = 'Monday – Friday, 9am – 5pm';
const NEW_ADDRESS = { street: '4 E Rolling Crossroads, Suites 301–303', city: 'Catonsville', state: 'MD', zip: '21228' };

exports.up = async function up(knex) {
  const parse = (row) => {
    try {
      return row ? JSON.parse(row.value) : null;
    } catch {
      return null;
    }
  };
  const address = parse(await knex('site_settings').where({ key: 'business.address' }).first());
  if (address && !address.zip && /Rolling Crossroads/.test(address.street || '')) {
    await knex('site_settings').where({ key: 'business.address' }).update({ value: JSON.stringify(NEW_ADDRESS) });
  }
  const hours = parse(await knex('site_settings').where({ key: 'business.hours' }).first());
  if (hours === OLD_HOURS) {
    await knex('site_settings').where({ key: 'business.hours' }).update({ value: JSON.stringify(NEW_HOURS) });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down() {
  // Content change only; nothing to undo.
};
