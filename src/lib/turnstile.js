'use strict';

const config = require('../config');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';

/**
 * Optional Cloudflare Turnstile check. Off unless TURNSTILE_SITE_KEY and
 * TURNSTILE_SECRET_KEY are set. If Cloudflare can't be reached we let the
 * submission through (the other spam layers still apply) rather than block
 * every visitor.
 *
 * @returns {Promise<boolean>} true if the visitor passed (or Turnstile is off)
 */
async function verifyTurnstile(req) {
  if (!config.turnstile.enabled) return true;

  const token = req.body['cf-turnstile-response'];
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: config.turnstile.secretKey, response: token, remoteip: req.ip || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('Turnstile verification unavailable, allowing submission:', err.message);
    return true;
  }
}

module.exports = { verifyTurnstile };
