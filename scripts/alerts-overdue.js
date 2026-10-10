'use strict';

// Flag website items nobody has picked up (see services/alerts.js).
// The app already checks every 15 minutes; this is for a cron job, e.g. hourly:
//   0 * * * * cd ~/hloinc-preview && node scripts/alerts-overdue.js
const db = require('../src/db/knex');
const { checkOverdue } = require('../src/services/alerts');

checkOverdue()
  .then((n) => console.log(n ? `Flagged ${n} item(s) waiting too long.` : 'Nothing waiting too long.'))
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(() => db.destroy());
