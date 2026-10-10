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
});

module.exports = app;
