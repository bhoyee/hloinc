'use strict';

const express = require('express');
const nunjucks = require('nunjucks');
const compression = require('compression');
const config = require('./config');
const site = require('./lib/site');
const { securityHeaders, csrf, limiters } = require('./middleware/security');
const { sessionMiddleware } = require('./middleware/session');
const { notFound, errorHandler } = require('./middleware/errors');

function createApp() {
  const app = express();

  // cPanel/Passenger sits behind Apache; trust it so req.ip and secure cookies work.
  app.set('trust proxy', 1);
  app.disable('x-powered-by');

  const env = nunjucks.configure(config.paths.views, {
    autoescape: true,
    express: app,
    noCache: !config.isProd,
  });
  env.addGlobal('currentYear', new Date().getFullYear());
  app.set('view engine', 'njk');

  app.use(securityHeaders());
  app.use(compression());
  app.use(
    express.static(config.paths.public, {
      maxAge: config.isProd ? '7d' : 0,
      index: false,
    })
  );
  app.use(limiters.global);
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware());
  app.use(csrf());

  app.use((req, res, next) => {
    res.locals.site = site.defaults;
    res.locals.nav = site.nav;
    res.locals.currentPath = req.path;
    next();
  });

  app.use('/', require('./routes/public'));
  app.use('/portal', require('./routes/portal'));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
