'use strict';

// Entry point. cPanel "Setup Node.js App" (Passenger) loads this file;
// locally run `npm run dev` or `npm start`.
const config = require('./src/config');
const { createApp } = require('./src/server');

const app = createApp();

app.listen(config.port, () => {
  console.log(`HLO Inc. running at ${config.appUrl} (${config.env})`);
  // Tell managers about website items nobody has picked up (Roles & permissions → Alerts).
  require('./src/services/alerts').startOverdueChecks();
  // Scan resumes the virus scanner couldn't check when they arrived.
  require('./src/services/applications').startRescans();
  // Email visitors a reminder the day before their appointment.
  require('./src/services/appointments').startReminders();
  // System health: daily backup, and tell IT when email, the virus scanner or storage has a problem.
  require('./src/services/health').startChecks();
});

module.exports = app;
