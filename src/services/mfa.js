'use strict';

const crypto = require('crypto');
const { generateSecret, generateURI, verify } = require('otplib');
const QRCode = require('qrcode');
const db = require('../db/knex');
const { encrypt, decrypt, sha256 } = require('../lib/crypto');

const ISSUER = 'HLO Staff Portal';
const RECOVERY_CODE_COUNT = 10;

/** Must this user use two-step sign-in? Set per role, while it's switched on for the portal. */
async function isRequiredFor(user) {
  if (!(await require('./security').twoStepOn())) return false;
  const role = await require('./roles').get(user.role);
  return Boolean(role && role.require_mfa);
}

/** What the setup page shows for a secret: QR code (SVG) and the key to type in by hand. */
async function enrollmentFor(user, secret) {
  const uri = generateURI({ issuer: ISSUER, label: user.email, secret });
  const qrSvg = await QRCode.toString(uri, { type: 'svg', margin: 1, errorCorrectionLevel: 'M' });
  return { secret, qrSvg, manualKey: secret.match(/.{1,4}/g).join(' ') };
}

const newSecret = () => generateSecret();

const cleanCode = (code) => String(code || '').replace(/\s+/g, '');

/** Check a 6-digit code against a secret, allowing ±30 s of clock drift. */
async function checkCode(secret, code, afterTimeStep) {
  const token = cleanCode(code);
  if (!/^\d{6}$/.test(token)) return null;
  const opts = { secret, token, epochTolerance: 30 };
  if (afterTimeStep != null) opts.afterTimeStep = Number(afterTimeStep);
  try {
    const result = await verify(opts);
    return result.valid ? result.timeStep : null;
  } catch {
    return null;
  }
}

/** Turn MFA on after the user proved they can generate codes. Returns fresh recovery codes. */
async function enable(userId, secret, timeStep) {
  await db('users')
    .where({ id: userId })
    .update({ mfa_enabled: true, mfa_secret: encrypt(secret), mfa_last_step: timeStep });
  return regenerateRecoveryCodes(userId);
}

async function disable(userId) {
  await db('users').where({ id: userId }).update({ mfa_enabled: false, mfa_secret: null, mfa_last_step: null });
  await db('mfa_recovery_codes').where({ user_id: userId }).del();
}

/** Ten single-use codes like "7KQ4-M2XP". Shown once; only hashes are stored. */
async function regenerateRecoveryCodes(userId) {
  const alphabet = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789'; // no 0/O/1/I
  const codes = Array.from({ length: RECOVERY_CODE_COUNT }, () => {
    const chars = Array.from(crypto.randomBytes(8), (b) => alphabet[b % alphabet.length]).join('');
    return `${chars.slice(0, 4)}-${chars.slice(4)}`;
  });
  await db('mfa_recovery_codes').where({ user_id: userId }).del();
  await db('mfa_recovery_codes').insert(codes.map((c) => ({ user_id: userId, code_hash: sha256(c) })));
  return codes;
}

/**
 * Verify a sign-in code: a 6-digit authenticator code (each can be used once)
 * or a recovery code (each can be used once). Returns 'totp', 'recovery' or null.
 */
async function verifyLogin(userId, input) {
  const user = await db('users').where({ id: userId }).first();
  if (!user || !user.mfa_enabled) return null;

  const secret = decrypt(user.mfa_secret);
  if (secret) {
    const step = await checkCode(secret, input, user.mfa_last_step);
    if (step != null) {
      // Conditional update: two simultaneous uses of the same code can't both win.
      const updated = await db('users')
        .where({ id: userId })
        .where((q) => q.whereNull('mfa_last_step').orWhere('mfa_last_step', '<', step))
        .update({ mfa_last_step: step });
      return updated ? 'totp' : null;
    }
  }

  const recovery = String(input || '').trim().toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (recovery.length === 8) {
    const formatted = `${recovery.slice(0, 4)}-${recovery.slice(4)}`;
    const used = await db('mfa_recovery_codes')
      .where({ user_id: userId, code_hash: sha256(formatted) })
      .whereNull('used_at')
      .update({ used_at: db.fn.now() });
    if (used) return 'recovery';
  }
  return null;
}

function remainingRecoveryCodes(userId) {
  return db('mfa_recovery_codes')
    .where({ user_id: userId })
    .whereNull('used_at')
    .count({ n: '*' })
    .first()
    .then((r) => Number(r.n));
}

module.exports = {
  isRequiredFor,
  enrollmentFor,
  newSecret,
  checkCode,
  enable,
  disable,
  regenerateRecoveryCodes,
  verifyLogin,
  remainingRecoveryCodes,
};
