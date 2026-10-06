'use strict';

const path = require('path');
const config = require('./src/config');

module.exports = {
  client: 'mysql2',
  connection: {
    ...config.db,
    charset: 'utf8mb4',
    timezone: 'Z',
    dateStrings: false,
  },
  // Shared hosting caps concurrent connections; keep the pool small.
  pool: { min: 0, max: 5 },
  migrations: {
    directory: path.join(__dirname, 'src/db/migrations'),
    tableName: 'knex_migrations',
  },
  seeds: {
    directory: path.join(__dirname, 'src/db/seeds'),
  },
};
