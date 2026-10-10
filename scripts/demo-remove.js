'use strict';

/**
 * Remove all demo data: `npm run demo:remove`
 *
 * Deletes only made-up records (see src/db/demo.js):
 *  - demo staff accounts (@hloinc.test) and their shifts, notifications and sign-in records
 *  - demo visitors' messages, referrals, requests and appointments (@example.com, 555-01xx phones)
 *  - leads that belonged only to them
 *  - demo job postings (development only)
 * Real accounts, real enquiries and settings are not touched.
 *
 * `npm run demo:remove -- --keep-staff` keeps the demo staff accounts (handy to
 * refresh the demo data: remove, then `npx knex seed:run`).
 *
 * Remember to also set DEMO_DATA=false (or remove it) in .env, or the next
 * deploy adds the demo data again.
 */
const db = require('../src/db/knex');
const demo = require('../src/db/demo');

const isDemoPhone = (p) => /555-?01\d\d$/.test(String(p || '').replace(/\s/g, ''));

async function main() {
  const keepStaff = process.argv.includes('--keep-staff');
  const staffIds = keepStaff ? [] : await db('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).pluck('id');

  const msgIds = await db('contact_messages').where('email', 'like', `%${demo.VISITOR_DOMAIN}`).pluck('id');
  const appts = await db('appointments').select('id', 'email', 'phone', 'staff_notes');
  const apptIds = appts
    .filter((a) => a.staff_notes === demo.MARK || (a.email && a.email.endsWith(demo.VISITOR_DOMAIN)) || (!a.email && isDemoPhone(a.phone)))
    .map((a) => a.id);

  const leadIds = [
    ...new Set([
      ...(await db('contact_messages').whereIn('id', msgIds).whereNotNull('lead_id').pluck('lead_id')),
      ...(await db('appointments').whereIn('id', apptIds).whereNotNull('lead_id').pluck('lead_id')),
      ...(await db('leads').where('email', 'like', `%${demo.VISITOR_DOMAIN}`).pluck('id')),
    ]),
  ];

  const counts = {};
  await db.transaction(async (trx) => {
    counts.messages = await trx('contact_messages').whereIn('id', msgIds).del();
    counts.appointments = await trx('appointments').whereIn('id', apptIds).del();
    // Only leads with nothing real left on them.
    const stillUsed = new Set([
      ...(await trx('contact_messages').whereIn('lead_id', leadIds).pluck('lead_id')),
      ...(await trx('appointments').whereIn('lead_id', leadIds).pluck('lead_id')),
    ]);
    counts.leads = await trx('leads').whereIn('id', leadIds.filter((id) => !stillUsed.has(id))).del();
    counts.signIns = await trx('audit_log').where({ ip: demo.AUDIT_IP }).del();
    // Seeded shifts have no "created by"; with --keep-staff, shifts people added themselves stay.
    const demoStaff = await trx('users').where('email', 'like', `%${demo.STAFF_DOMAIN}`).pluck('id');
    counts.shifts = await trx('shifts').whereIn('user_id', keepStaff ? demoStaff : staffIds).modify((q) => { if (keepStaff) q.whereNull('created_by'); }).del();
    counts.notifications = await trx('notifications').whereIn('user_id', staffIds).del();
    counts.staff = await trx('users').whereIn('id', staffIds).del();
    if (process.env.NODE_ENV !== 'production') {
      counts.jobs = await trx('jobs').where('apply_url', 'https://workforcenow.adp.com/').where('slug', 'like', '%-%').whereNotNull('pay_range').del();
    }
  });

  console.log('Demo data removed:');
  for (const [what, n] of Object.entries(counts)) console.log(`  ${what}: ${n}`);
  if (process.env.DEMO_DATA === 'true') console.log('\nDEMO_DATA=true is still set in .env, so the next deploy will add demo data again. Set it to false to stop that.');
}

main()
  .catch((err) => {
    console.error('Could not remove demo data:', err.message);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
