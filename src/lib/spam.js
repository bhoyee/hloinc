'use strict';

const crypto = require('crypto');
const config = require('../config');

/**
 * Layered spam protection for public forms. Every layer is cheap and
 * invisible to real visitors:
 *
 *  1. botCheck (before validation)
 *     - honeypot fields people never see
 *     - a one-time form token from the page render (stops replays and
 *       posting straight to the URL), with a minimum fill time
 *     - link spam in free-text fields
 *  2. repeatCheck (after validation)
 *     - the same submission again within 10 minutes
 *     - too many submissions from one email address in 24 hours
 *
 * Plus, elsewhere: CSRF + cross-site checks (middleware/security.js), rate
 * limits per IP, and optional Cloudflare Turnstile (lib/turnstile.js).
 */

const HONEYPOTS = ['website', 'email_confirm'];
const MAX_LINKS = 2;
const DUPLICATE_WINDOW_MS = 10 * 60 * 1000;
const EMAIL_WINDOW_MS = 24 * 60 * 60 * 1000;

// In memory: resets on restart, which is fine for a short-window spam guard.
// Emails are stored hashed.
const recentSubmissions = new Map(); // hash -> time
const submissionsByEmail = new Map(); // hashed email -> [times]

const sha256 = (s) => crypto.createHash('sha256').update(s).digest('hex');

function log(formName, reason) {
  if (!config.isTest) console.warn(`[spam] ${formName}: blocked (${reason})`);
}

/** Record that a form was rendered. A re-rendered form keeps its original time. */
function issueForm(req, formName) {
  req.session.formIssued = { ...(req.session.formIssued || {}), [formName]: req.formIssuedAt || Date.now() };
}

/**
 * Bot signals, checked before validation. Consumes the form token, so each
 * rendered form can be submitted once. Returns a reason string, or null.
 */
function botCheck(req, formName, textFields = []) {
  const issued = req.session.formIssued && req.session.formIssued[formName];
  if (req.session.formIssued) delete req.session.formIssued[formName];
  req.formIssuedAt = issued;

  let reason = null;
  if (HONEYPOTS.some((f) => req.body[f])) reason = 'honeypot';
  else if (!issued) reason = 'no form token';
  else if (Date.now() - issued < config.forms.minSubmitSeconds * 1000) reason = 'too fast';
  else {
    const text = textFields.map((f) => String(req.body[f] || '')).join('\n');
    const links = (text.match(/https?:\/\/|www\./gi) || []).length;
    if (links > MAX_LINKS || /<a\s|\[url[=\]]/i.test(text)) reason = 'link spam';
  }

  if (reason) log(formName, reason);
  return reason;
}

function prune(now) {
  for (const [hash, at] of recentSubmissions) if (now - at > DUPLICATE_WINDOW_MS) recentSubmissions.delete(hash);
  for (const [key, times] of submissionsByEmail) {
    const kept = times.filter((t) => now - t < EMAIL_WINDOW_MS);
    if (kept.length) submissionsByEmail.set(key, kept);
    else submissionsByEmail.delete(key);
  }
}

/**
 * Repeat checks, after validation, just before saving. Returns:
 *  - 'duplicate': same submission again recently (drop quietly; the first one was saved)
 *  - 'limit': too many from this email today (tell the person, so a real one can call)
 *  - null: OK, and the submission is recorded.
 */
function repeatCheck(formName, email, data) {
  const now = Date.now();
  prune(now);

  const emailKey = sha256(String(email).toLowerCase());
  const hash = sha256(`${formName}\0${emailKey}\0${JSON.stringify(data)}`);

  if (recentSubmissions.has(hash)) {
    log(formName, 'duplicate');
    return 'duplicate';
  }
  const times = submissionsByEmail.get(emailKey) || [];
  if (times.length >= config.forms.maxPerEmailPerDay) {
    log(formName, 'daily email limit');
    return 'limit';
  }

  recentSubmissions.set(hash, now);
  submissionsByEmail.set(emailKey, [...times, now]);
  return null;
}

/** Test helper. */
function _reset() {
  recentSubmissions.clear();
  submissionsByEmail.clear();
}

module.exports = { issueForm, botCheck, repeatCheck, HONEYPOTS, _reset };
