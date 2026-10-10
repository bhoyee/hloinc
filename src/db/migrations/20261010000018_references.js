'use strict';

const { make } = require('../../lib/reference');

/**
 * Readable reference numbers (like HLO-REQ-7K3M9P) for website messages,
 * referrals, service requests and appointments, replacing the bare row
 * number in emails and the staff portal. Existing rows get one too.
 *
 * @param {import('knex').Knex} knex
 */
exports.up = async function up(knex) {
  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => {
      t.string('reference', 20).nullable().after('id');
    });
  }

  const used = new Set();
  const fresh = (kind) => {
    let ref;
    do ref = make(kind);
    while (used.has(ref));
    used.add(ref);
    return ref;
  };
  for (const m of await knex('contact_messages').select('id', 'type')) {
    await knex('contact_messages').where({ id: m.id }).update({ reference: fresh(m.type) });
  }
  for (const a of await knex('appointments').select('id')) {
    await knex('appointments').where({ id: a.id }).update({ reference: fresh('appointment') });
  }

  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => {
      t.unique(['reference'], { indexName: `${table}_reference_unique` });
    });
  }
};

/** @param {import('knex').Knex} knex */
exports.down = async function down(knex) {
  for (const table of ['contact_messages', 'appointments']) {
    await knex.schema.alterTable(table, (t) => {
      t.dropUnique(['reference'], `${table}_reference_unique`);
      t.dropColumn('reference');
    });
  }
};
