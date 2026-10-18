'use strict';

const config = require('../config');

const VERIFY_URL = 'https://challenges.cloudflare.com/turnstile/v0/siteverify';
const SETTING = 'security.turnstile';
const TTL_MS = 10 * 1000; // short, so a change reaches every server process quickly

/**
 * Cloudflare Turnstile ("verify you're human", usually invisible) on the public forms.
 *
 * Switched on and off, with its keys, by the CEO/COO under Administration → Security
 * settings. The secret key is stored encrypted and never shown again. Until it is set
 * there, TURNSTILE_SITE_KEY and TURNSTILE_SECRET_KEY in .env are used (on when both
 * are set). If Cloudflare can't be reached we let a submission through (the other spam
 * layers still apply) rather than block every visitor.
 */
let cache = { at: 0, value: null };

function fromEnv() {
  const { siteKey, secretKey } = config.turnstile;
  return { enabled: Boolean(siteKey && secretKey), siteKey, secretKey, source: 'env' };
}

/** { enabled, siteKey, secretKey, source: 'portal' | 'env', updatedAt, updatedBy } */
async function settings() {
  if (cache.value && Date.now() - cache.at < TTL_MS) return cache.value;
  let value = fromEnv();
  try {
    const db = require('../db/knex');
    const row = await db('site_settings as s').leftJoin('users as u', 'u.id', 's.updated_by').where('s.key', SETTING).first('s.value', 's.updated_at', 'u.name');
    if (row) {
      const v = require('./stored').fromDb(row.value) || {};
      const secretKey = v.secret ? require('./crypto').decrypt(v.secret) || '' : '';
      value = { enabled: Boolean(v.enabled && v.siteKey && secretKey), siteKey: v.siteKey || '', secretKey, source: 'portal', updatedAt: row.updated_at, updatedBy: row.name };
    }
  } catch (err) {
    // The database is briefly unavailable: keep the last known settings (or .env).
    if (cache.value) return cache.value;
    console.error('Could not read Turnstile settings:', err.message);
  }
  cache = { at: Date.now(), value };
  return value;
}

/** Save from the portal. A blank secret keeps the saved one. */
async function save({ enabled, siteKey, secretKey }, user) {
  const db = require('../db/knex');
  const secret = secretKey || (await settings()).secretKey;
  const value = { enabled: Boolean(enabled), siteKey: siteKey || '', secret: secret ? require('./crypto').encrypt(secret) : '' };
  await db('site_settings')
    .insert({ key: SETTING, value: JSON.stringify(value), updated_by: user.id, updated_at: new Date() })
    .onConflict('key')
    .merge();
  clearCache();
}

function clearCache() {
  cache = { at: 0, value: null };
}

/**
 * Ask Cloudflare whether a secret key is real: a check with a made-up token fails either
 * way, but only a wrong secret is reported as "invalid-input-secret".
 * @returns {Promise<'ok'|'bad'|'unreachable'>}
 */
async function checkSecret(secretKey) {
  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: secretKey, response: 'key-check' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return (data['error-codes'] || []).includes('invalid-input-secret') ? 'bad' : 'ok';
  } catch {
    return 'unreachable';
  }
}

/**
 * @returns {Promise<boolean>} true if the visitor passed (or Turnstile is off)
 */
async function verifyTurnstile(req) {
  const t = await settings();
  if (!t.enabled) return true;

  const token = req.body['cf-turnstile-response'];
  if (!token) return false;

  try {
    const res = await fetch(VERIFY_URL, {
      method: 'POST',
      body: new URLSearchParams({ secret: t.secretKey, response: token, remoteip: req.ip || '' }),
      signal: AbortSignal.timeout(5000),
    });
    const data = await res.json();
    return data.success === true;
  } catch (err) {
    console.error('Turnstile verification unavailable, allowing submission:', err.message);
    return true;
  }
}

module.exports = { verifyTurnstile, settings, save, checkSecret, clearCache, ORIGIN: 'https://challenges.cloudflare.com' };
