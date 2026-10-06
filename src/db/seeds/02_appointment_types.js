'use strict';

/**
 * DRAFT appointment types — HLO must approve the list, durations and
 * capacity (client question 5). "General appointment" is deliberately absent.
 * Only inserts when the table is empty so portal edits are never overwritten.
 */
exports.seed = async function seed(knex) {
  const { count } = await knex('appointment_types').count({ count: '*' }).first();
  if (Number(count) > 0) return;

  await knex('appointment_types').insert([
    {
      name: 'Intake consultation',
      description: 'Talk with our intake team about services and next steps.',
      duration_minutes: 60,
      capacity: 1,
      sort_order: 1,
    },
    {
      name: 'Office visit with a program coordinator',
      description: 'Meet a coordinator about current services or planning.',
      duration_minutes: 30,
      capacity: 1,
      sort_order: 2,
    },
  ]);
};
