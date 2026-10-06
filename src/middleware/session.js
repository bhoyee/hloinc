'use strict';

const session = require('express-session');
const config = require('../config');

function createStore() {
  if (config.isTest) return new session.MemoryStore();

  const MySQLStore = require('express-mysql-session')(session);
  return new MySQLStore({
    ...config.db,
    createDatabaseTable: true,
    clearExpired: true,
    checkExpirationInterval: 15 * 60 * 1000,
    connectionLimit: 2,
  });
}

function sessionMiddleware() {
  return session({
    name: 'hlo.sid',
    secret: config.session.secret,
    store: createStore(),
    resave: false,
    saveUninitialized: false,
    // Each request pushes the expiry forward, so the timeout is idle time.
    rolling: true,
    cookie: {
      httpOnly: true,
      sameSite: 'lax',
      secure: config.isProd,
      maxAge: config.session.idleMinutes * 60 * 1000,
    },
  });
}

module.exports = { sessionMiddleware };
