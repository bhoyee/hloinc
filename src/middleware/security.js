'use strict';

const crypto = require('crypto');
const helmet = require('helmet');
const rateLimit = require('express-rate-limit');
const config = require('../config');

function securityHeaders() {
  return helmet({
    contentSecurityPolicy: {
      useDefaults: false,
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'"],
        styleSrc: ["'self'"],
        imgSrc: ["'self'", 'data:'],
        fontSrc: ["'self'"],
        connectSrc: ["'self'"],
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

    const sent = (req.body && req.body._csrf) || req.get('x-csrf-token') || '';
    const expected = req.session.csrfToken || '';
    const ok =
      sent.length === expected.length &&
      expected.length > 0 &&
      crypto.timingSafeEqual(Buffer.from(sent), Buffer.from(expected));

    if (!ok) {
      const err = new Error('Invalid or missing form token. Please reload the page and try again.');
      err.status = 403;
      return next(err);
    }
    return next();
  };
}

// Automated tests submit many forms quickly; limits are exercised manually.
const skip = () => config.isTest;

const limiters = {
  // Applied to every request — generous; stops floods, not people.
  global: rateLimit({ windowMs: 60 * 1000, limit: 300, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
  // Public forms (contact, appointment requests).
  forms: rateLimit({ windowMs: 15 * 60 * 1000, limit: 10, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
  // Staff login attempts per IP (per-account lockout is handled separately).
  login: rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-8', legacyHeaders: false, skip }),
};

module.exports = { securityHeaders, csrf, limiters };
