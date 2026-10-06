'use strict';

const db = require('../db/knex');
const config = require('../config');
const { sha256, randomToken } = require('../lib/crypto');

const LIFETIME_MS = {
  reset: () => config.auth.resetTokenMinutes * 60 * 1000,
  invite: () => config.auth.inviteTokenHours * 60 * 60 * 1000,
};

/**
 * Create a one-time link token. Any earlier unused token for the same
 * purpose stops working, so only the newest link is valid.
 * Returns the raw token (sent by email); only its hash is stored.
 */
async function issue(userId, purpose, ip) {
  const token = randomToken();
  await db('password_tokens').where({ user_id: userId, purpose }).whereNull('used_at').update({ used_at: db.fn.now() });
  await db('password_tokens').insert({
    user_id: userId,
    purpose,
    token_hash: sha256(token),
    expires_at: new Date(Date.now() + LIFETIME_MS[purpose]()),
    created_ip: ip || null,
  });
  return token;
}

/** The token row if it's valid (right purpose, unused, unexpired), else null. Doesn't use it up. */
async function check(token, purpose) {
  if (!token || typeof token !== 'string' || token.length > 100) return null;
  const row = await db('password_tokens').where({ token_hash: sha256(token), purpose }).first();
  if (!row || row.used_at || new Date(row.expires_at) <= new Date()) return null;
  return row;
}

/** Mark a token used. Returns false if it was already used (e.g. a double submit). */
async function consume(row) {
  const updated = await db('password_tokens').where({ id: row.id }).whereNull('used_at').update({ used_at: db.fn.now() });
  return updated === 1;
}

/** Cancel all outstanding links for a user (e.g. when the account is deactivated). */
function revokeAll(userId) {
  return db('password_tokens').where({ user_id: userId }).whereNull('used_at').update({ used_at: db.fn.now() });
}

module.exports = { issue, check, consume, revokeAll };
