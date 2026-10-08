'use strict';

const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');

function securityHeaders() {
  // Cloudflare Turnstile needs its script, frame and API only when enabled.
  const turnstile = config.turnstile.enabled ? ['https://challenges.cloudflare.com'] : [];
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", ...turnstile],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'", ...turnstile],
        // Google Maps loads only after the visitor clicks "Show map" on the contact page.
        frameSrc: ["'self'", 'https://www.google.com', ...turnstile],
        formAction: ["'self'"],
        frameAncestors: ["'none'"],
        objectSrc: ["'none'"],
        baseUri: ["'self'"],
        ...(config.isProd ? { upgradeInsecureRequests: [] } : {}),
      },
    },
    strictTransportSecurity: config.isProd ? { maxAge: 31536000, includeSubDomains: true } : false,
    referrerPolicy: { policy: 'strict-origin-when-cross-origin' },
  });
}

/**
 * Synchronizer-token CSRF protection. The token lives in the session and
 * every unsafe request must echo it back as `_csrf` (form) or `x-csrf-token`.
 */
function csrf() {
  const SAFE = new Set(['GET', 'HEAD', 'OPTIONS']);

  return function csrfMiddleware(req, res, next) {
    res.locals.csrfToken = () => {
      if (!req.session.csrfToken) req.session.csrfToken = crypto.randomBytes(32).toString('hex');
      return req.session.csrfToken;
    };

    if (SAFE.has(req.method)) return next();

    // Reject form posts sent from other websites before checking the token.
    if (isCrossSite(req)) {
      const err = new Error('This form must be submitted from our website.');
      err.status = 403;
      return next(err);
    }

    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    const expected = req.session.csrfToken || '';
    const ok =
      sent.length === expected.length &&
      expected.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

    if (!ok) {
      // Background requests from our own scripts get a plain error.
      if (req.get('x-csrf-token') || (req.get('accept') || '').includes('application/json')) {
        const err = new Error('Invalid or missing form token. Please reload the page and try again.');
        err.status = 403;
        return next(err);
      }
      // Usually a page left open so long that the session ended (or a tab from
      // before signing in again). Nothing is saved; explain instead of erroring.
      const back = sameSiteReferer(req) || (req.originalUrl.startsWith('/portal') ? '/portal' : '/');
      if (req.originalUrl.startsWith('/portal') && !req.originalUrl.startsWith('/portal/login') && !req.session.userId) {
        return res.redirect(303, `/portal/login?${new URLSearchParams({ ended: 'expired', next: back })}`);
      }
      req.session.flash = { type: 'warning', message: STALE_FORM };
      return res.redirect(303, back);
    }
    return next();
  };
}

const STALE_FORM = 'This page had been open for a while, so for your security nothing was sent. Please try again.';

/** The page the form was on, if it's on this site (path and query only). */
function sameSiteReferer(req) {
  try {
    const url = new URL(req.get('referer') || '');
    return url.host === req.get('host') && !url.pathname.startsWith('//') ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

// Automated tests submit many forms quickly; limits are exercised manually.
const skip = () => config.isTest;

/** True when the browser says the request came from another site. */
function isCrossSite(req) {
  if (req.get('sec-fetch-site') === 'cross-site') return true;
  const origin = req.get('origin');
  if (!origin || origin === 'null') return false;
  try {
    return new URL(origin).host !== req.get('host');
  } catch {
    return true;
  }
}

const limiters = {
  // Applied to every request — generous; stops floods, not people.
  global: rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
  // Public forms (contact, appointment requests).
  forms: rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
  // Staff login attempts per IP (per-account lockout is handled separately).
  login: rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
};

module.exports = { securityHeaders, csrf, limiters };
