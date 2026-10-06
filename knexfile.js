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
    // Return JSON columns as raw text on both MySQL and MariaDB (MariaDB stores
    // JSON as LONGTEXT), so callers always JSON.parse exactly once.
    typeCast(field, next) {
      if (field.type === 'JSON') return field.string('utf8');
      return next();
    },
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
