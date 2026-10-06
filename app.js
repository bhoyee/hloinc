'use strict';

// Entry point. cPanel "Setup Node.js App" (Passenger) loads this file;
// locally run `npm run dev` or `npm start`.
const config = require('./src/config');
const { createApp } = require('./src/server');

const app = createApp();

app.listen(config.port, () => {
  console.log(`HLO Inc. running at ${config.appUrl} (${config.env})`);
});

module.exports = app;
