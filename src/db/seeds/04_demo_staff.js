'use strict';

/**
 * DEMO staff accounts, one per role, so each role's view of the portal can be
 * tried. Runs in development, and on a server only with DEMO_DATA=true and a
 * DEMO_PASSWORD in its .env (see src/db/demo.js). If DEMO_PASSWORD changes, the
 * next deploy (or `npx knex seed:run`) updates the demo logins to match. Emails use the reserved
 * .test domain, so nothing can be delivered to a real person.
 */
const bcrypt = require('bcryptjs');
const demo = require('../demo');

const STAFF = [
  ['Avery Admin', 'admin@hloinc.test', 'admin'],
  ['Ian IT', 'it@hloinc.test', 'it_admin'],
  ['Dana Director', 'director@hloinc.test', 'program_director'],
  ['Casey Coordinator', 'coordinator@hloinc.test', 'program_coordinator'],
  ['Indira Intake', 'intake@hloinc.test', 'intake_specialist'],
  ['Riley Reception', 'reception@hloinc.test', 'reception'],
];

exports.seed = async function seed(knex) {
  if (!demo.allowed()) return;
  const password = demo.staffPassword();
  if (!password) {
    console.warn('Demo staff not created: set DEMO_PASSWORD (12+ characters) in .env to add them.');
    return;
  }

  const hash = await bcrypt.hash(password, 10);
  for (const [name, email, role] of STAFF) {
    const exists = await knex('users').where({ email }).first();
    if (!exists) {
      await knex('users').insert({ name, email, role, password_hash: hash, password_changed_at: knex.fn.now() });
    } else if (!(await bcrypt.compare(password, exists.password_hash || ''))) {
      // DEMO_PASSWORD was changed in .env: bring the demo login up to date (and unlock it).
      // Their sessions end, as with any password change. Two-step settings are left alone.
      await knex('users').where({ id: exists.id }).update({
        password_hash: hash,
        password_changed_at: knex.fn.now(),
        failed_login_count: 0,
        locked_until: null,
        session_version: knex.raw('session_version + 1'),
      });
      console.log(`Demo password updated for ${email}`);
    }
  }
};
