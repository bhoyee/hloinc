'use strict';

const crypto = require('crypto');
const config = require('../config');

// 256-bit key derived from APP_KEY.
const KEY = crypto.createHash('sha256').update(config.auth.appKey).digest();

/** AES-256-GCM. Output: "v1:<iv>:<tag>:<ciphertext>" (base64url parts). */
function encrypt(plain) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(String(plain), 'utf8'), cipher.final()]);
  return ['v1', iv, cipher.getAuthTag(), data].map((p) => (Buffer.isBuffer(p) ? p.toString('base64url') : p)).join(':');
}

/** Returns the plain text, or null if the value was tampered with or the key changed. */
function decrypt(value) {
  try {
    const [version, iv, tag, data] = String(value).split(':');
    if (version !== 'v1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    return Buffer.concat([decipher.update(Buffer.from(data, 'base64url')), decipher.final()]).toString('utf8');
  } catch {
    return null;
  }
}

/** Encrypt a file's bytes (AES-256-GCM). Output: "HLO1" + iv(12) + tag(16) + ciphertext. */
function encryptBuffer(buf) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', KEY, iv);
  const data = Buffer.concat([cipher.update(buf), cipher.final()]);
  return Buffer.concat([Buffer.from('HLO1'), iv, cipher.getAuthTag(), data]);
}

/** The original bytes, or null if the file was altered or the key changed. */
function decryptBuffer(buf) {
  try {
    if (buf.subarray(0, 4).toString() !== 'HLO1') return null;
    const decipher = crypto.createDecipheriv('aes-256-gcm', KEY, buf.subarray(4, 16));
    decipher.setAuthTag(buf.subarray(16, 32));
    return Buffer.concat([decipher.update(buf.subarray(32)), decipher.final()]);
  } catch {
    return null;
  }
}

const sha256 = (s) => crypto.createHash('sha256').update(String(s)).digest('hex');

/** URL-safe random token (256 bits by default). */
const randomToken = (bytes = 32) => crypto.randomBytes(bytes).toString('base64url');

/** Constant-time string comparison. */
function safeEqual(a, b) {
  const x = Buffer.from(String(a));
  const y = Buffer.from(String(b));
  return x.length === y.length && crypto.timingSafeEqual(x, y);
}

module.exports = { encrypt, decrypt, encryptBuffer, decryptBuffer, sha256, randomToken, safeEqual };
