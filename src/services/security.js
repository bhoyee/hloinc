'use strict';

/*
 * Portal-wide security settings, changed by the CEO/COO under
 * Administration → Security settings.
 *
 * Two-step sign-in (authenticator app) starts OFF on a new installation
 * (migration 020); the CEO/COO switches it on here. When it is OFF, everyone
 * signs in with email and password only, and no role is made
 * to set it up. People's authenticator set-ups are kept, so switching it back
 * on works straight away.
 */
const db = require('../db/knex');

const KEY = 'security.two_step';
const TTL_MS = 10 * 1000; // short, so a change reaches every server process quickly
let cache = { at: 0, on: true };

/** Is two-step sign-in switched on for the portal? */
async function twoStepOn() {
  if (Date.now() - cache.at < TTL_MS) return cache.on;
  try {
    const row = await db('site_settings').where({ key: KEY }).first();
    const on = row ? JSON.parse(row.value) !== false : true;
    cache = { at: Date.now(), on };
  } catch (err) {
    // Fail safe: if the setting can't be read, keep two-step on.
    console.error('Could not read security settings:', err.message);
    return true;
  }
  return cache.on;
}

async function setTwoStep(on, user) {
  await db('site_settings')
    .insert({ key: KEY, value: JSON.stringify(Boolean(on)), updated_by: user.id, updated_at: new Date() })
    .onConflict('key')
    .merge();
  cache = { at: 0, on: true };
}

/** Who changed it last, and when. */
function lastChange() {
  return db('site_settings as s').leftJoin('users as u', 'u.id', 's.updated_by').select('s.updated_at', 'u.name').where('s.key', KEY).first();
}

function clearCache() {
  cache = { at: 0, on: true };
}

module.exports = { twoStepOn, setTwoStep, lastChange, clearCache };
