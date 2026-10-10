// Creates and migrates the test database once per test run.
// Tests need a local MySQL/MariaDB (see .env); they use `<DB_NAME>_test`.
const mysql = require('mysql2/promise');

module.exports = async function setup() {
  process.env.NODE_ENV = 'test';
  const config = require('../../src/config');
  const { host, port, user, password, database } = config.db;

  const conn = await mysql.createConnection({ host, port, user, password });
  await conn.query(`CREATE DATABASE IF NOT EXISTS \`${database}\` CHARACTER SET utf8mb4 COLLATE utf8mb4_unicode_ci`);
  await conn.end();

  const db = require('../../src/db/knex');
  await db.migrate.latest();
  await db.seed.run();
  // Migration 020 starts real installs with two-step off; tests start from "not chosen" (on) and set it themselves.
  await db('site_settings').where({ key: 'security.two_step' }).del();
  await db.destroy();
};
