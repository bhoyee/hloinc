'use strict';

/**
 * DEMO staff accounts, one per role, so each role's view of the portal can be
 * tried. Development only — never runs in production. Emails use the
 * reserved .test domain, so nothing can be delivered to a real person.
 */
const bcrypt = require('bcryptjs');

const PASSWORD = 'Portal-Demo-2026!';

const STAFF = [
  ['Avery Admin', 'admin@hloinc.test', 'admin'],
  ['Ian IT', 'it@hloinc.test', 'it_admin'],
  ['Dana Director', 'director@hloinc.test', 'program_director'],
  ['Casey Coordinator', 'coordinator@hloinc.test', 'program_coordinator'],
  ['Indira Intake', 'intake@hloinc.test', 'intake_specialist'],
  ['Riley Reception', 'reception@hloinc.test', 'reception'],
];

exports.seed = async function seed(knex) {
  if (process.env.NODE_ENV === 'production' || process.env.NODE_ENV === 'test') return;

  const hash = await bcrypt.hash(PASSWORD, 10);
  for (const [name, email, role] of STAFF) {
    const exists = await knex('users').where({ email }).first();
    if (!exists) {
      await knex('users').insert({ name, email, role, password_hash: hash, password_changed_at: knex.fn.now() });
    }
  }
};
