'use strict';

const { defaults } = require('../../lib/site');

/** Inserts default business details; never overwrites edits made in the portal. */
exports.seed = async function seed(knex) {
  const rows = [
    { key: 'business.phone', value: JSON.stringify(defaults.phone) },
    { key: 'business.email', value: JSON.stringify(defaults.email) },
    { key: 'business.address', value: JSON.stringify(defaults.address) },
    { key: 'business.hours', value: JSON.stringify(defaults.hours) },
  ];
  await knex('site_settings').insert(rows).onConflict('key').ignore();
};
