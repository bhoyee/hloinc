'use strict';

const path = require('path');
const express = require('express');
const nunjucks = require('nunjucks');
const compression = require('compression');
const config = require('./config');
const site = require('./lib/site');
const { securityHeaders, csrf, limiters } = require('./middleware/security');
const { sessionMiddleware } = require('./middleware/session');
const { notFound, errorHandler } = require('./middleware/errors');
const { flashMiddleware } = require('./lib/forms');
const content = require('./services/content');
const cms = require('./services/cms');
const { icon } = require('./lib/icons');
const { richText, highlight } = require('./lib/text');

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
  env.addGlobal('cms', cms.helpers);
  env.addGlobal('icon', (name, className) => new nunjucks.runtime.SafeString(icon(name, className)));
  env.addFilter('telHref', (phone) => `tel:+1${String(phone).replace(/\D/g, '').replace(/^1/, '')}`);
  env.addFilter('richText', (text) => new nunjucks.runtime.SafeString(richText(text)));
  env.addFilter('highlight', (text, query) => new nunjucks.runtime.SafeString(highlight(text, query)));
  // Maryland-time display helpers: "9:30 a.m." and "Thu, Oct 8 · 9:30 a.m."
  const ampm = (t) => t.replace(':00', '').replace(' AM', ' a.m.').replace(' PM', ' p.m.');
  env.addFilter('time', (value) =>
    value ? ampm(new Date(value).toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' })) : ''
  );
  env.addFilter('dateTime', (value) => {
    if (!value) return '';
    const d = new Date(value);
    const day = d.toLocaleDateString('en-US', { timeZone: 'America/New_York', weekday: 'short', month: 'short', day: 'numeric' });
    return `${day} · ${ampm(d.toLocaleTimeString('en-US', { timeZone: 'America/New_York', hour: 'numeric', minute: '2-digit' }))}`;
  });
  // First paragraph of staff-written text, shortened for cards.
  env.addFilter('excerpt', (text, max = 170) => {
    const first = String(text || '').split(/\n{2,}/)[0].replace(/\s+/g, ' ').trim();
    if (first.length <= max) return first;
    return `${first.slice(0, max).replace(/\s+\S*$/, '').replace(/[\s.,;:!?]+$/, '')}…`;
  });
  // For <script type="application/ld+json">: escape "<" so text can't close the tag.
  env.addFilter('jsonld', (obj) => new nunjucks.runtime.SafeString(JSON.stringify(obj).replace(/</g, '\\u003c')));
  env.addFilter('date', (value, opts = { month: 'long', day: 'numeric', year: 'numeric' }) => {
    if (!value) return '';
    // A bare YYYY-MM-DD is a calendar date, not an instant: don't shift it by time zone.
    if (typeof value === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(value)) {
      return new Date(`${value}T12:00:00Z`).toLocaleDateString('en-US', { timeZone: 'UTC', ...opts });
    }
    return new Date(value).toLocaleDateString('en-US', { timeZone: 'America/New_York', ...opts });
  });
  app.set('view engine', 'njk');

  app.use(securityHeaders());
  app.use(compression());
  app.use(
    express.static(config.paths.public, {
      maxAge: config.isProd ? '7d' : 0,
      index: false,
    })
  );
  // Images uploaded in the page editor (kept outside the code, in storage/uploads).
  app.use('/uploads', express.static(path.join(config.paths.storage, 'uploads'), { maxAge: config.isProd ? '30d' : 0, index: false, dotfiles: 'ignore' }));
  app.use(limiters.global);
  app.use(async (req, res, next) => {
    res.locals.site = await content.getBusiness();
    res.locals.nav = site.nav;
    res.locals.currentPath = req.path;
    res.locals.turnstileSiteKey = config.turnstile.enabled ? config.turnstile.siteKey : '';
    next();
  });
  app.use(require('./routes/legacy'));
  app.use(express.urlencoded({ extended: false, limit: '100kb' }));
  app.use(express.json({ limit: '100kb' }));
  app.use(sessionMiddleware());
  app.use(csrf());
  app.use(flashMiddleware);
  // Page content for the templates (published, or drafts in the visual editor).
  app.use(cms.middleware());

  app.use('/', require('./routes/public'));
  app.use('/portal', require('./routes/portal'));

  app.use(notFound);
  app.use(errorHandler);

  return app;
}

module.exports = { createApp };
