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
  // Added to script and stylesheet links (?v=…). Static files are cached for 7 days in production;
  // this changes on every restart (each deploy restarts the app), so browsers fetch fresh copies.
  env.addGlobal('assetV', Date.now().toString(36));
  env.addGlobal('cms', cms.helpers);
  // Starting content of the redesigned public pages (menu, services, glossary…).
  env.addGlobal('design', require('./content/design'));
  // ['a', 'b'] -> [{ name: 'a' }, { name: 'b' }]: plain lists as editable list items.
  env.addFilter('listOf', (arr, key) => (Array.isArray(arr) ? arr.map((v) => ({ [key]: v })) : []));
  env.addGlobal('icon', (name, className) => new nunjucks.runtime.SafeString(icon(name, className)));
  // The editor's starting content (clean HTML) from saved text of either kind, and its plain-text fallback.
  env.addFilter('editorHtml', (value) => new nunjucks.runtime.SafeString(richText(value)));
  env.addFilter('editorText', (value) => (require('./lib/richText').isHtml(value) ? require('./lib/richText').toText(require('./lib/richText').clean(value)) : value || ''));
  env.addFilter('initials', (name) => require('./lib/avatar').initials(name));
  env.addFilter('avatarColor', (name) => require('./lib/avatar').color(name));
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
  // The words of the first paragraph of formatted (HTML) text, e.g. a job's summary on Careers.
  env.addFilter('firstParagraph', (html) => {
    const s = String(html || '');
    const first = (s.match(/<p[^>]*>([\s\S]*?)<\/p>/) || s.match(/<li[^>]*>([\s\S]*?)<\/li>/) || [null, s])[1];
    return first
      .replace(/<br\s*\/?>/g, ' ')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;|&#x27;/g, "'").replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim();
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
  // Preview site: keep every page out of search engines.
  if (config.noindex) {
    app.use((req, res, next) => {
      res.set('X-Robots-Tag', 'noindex, nofollow');
      next();
    });
  }
  app.use(compression());
  // Site images may be shown elsewhere, e.g. the logo in emails read in webmail.
  app.use('/img', (req, res, next) => {
    res.setHeader('Cross-Origin-Resource-Policy', 'cross-origin');
    next();
  });
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
  // Job applications are multipart (with a resume), so read them here for the CSRF check below.
  app.post('/careers/:slug/apply', limiters.applications, require('./routes/applicationUpload'));
  app.post('/careers/apply', limiters.applications, require('./routes/applicationUpload'));
  // Profile photos are multipart too.
  app.post('/portal/account/avatar', require('./routes/avatarUpload'));
  app.post('/portal/help', require('./routes/helpUpload'));
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
