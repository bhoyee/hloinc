'use strict';

const config = require('../config');
const users = require('../services/users');
const roles = require('../services/roles');
const { can } = require('../auth/permissions');

const AUTH_KEYS = ['userId', 'sessionVersion', 'loginAt', 'lastActivity', 'previousLoginAt', 'pendingMfa', 'mfaSetup'];

// Background requests (the notification bell and dashboard refreshes) don't count as activity,
// so an open but unattended tab still times out.
const BACKGROUND_PATHS = new Set(['/notifications/summary', '/dashboard/data']);

/** Forget who is signed in, but keep the session (and its CSRF token). */
function clearAuth(req) {
  for (const key of AUTH_KEYS) delete req.session[key];
}

/**
 * Sign a user in: new session ID (prevents session fixation), then record who
 * they are and which session_version they started with.
 */
function establishSession(req, user) {
  return new Promise((resolve, reject) => {
    req.session.regenerate((err) => {
      if (err) return reject(err);
      req.session.userId = user.id;
      req.session.sessionVersion = user.session_version;
      req.session.loginAt = Date.now();
      req.session.lastActivity = Date.now();
      req.session.save((saveErr) => (saveErr ? reject(saveErr) : resolve()));
    });
  });
}

/** After the user changes their own password, keep this session valid. */
function refreshSessionVersion(req, user) {
  req.session.sessionVersion = user.session_version;
}

/**
 * Load the signed-in user on every portal request, checking the account is
 * still active, sessions weren't revoked, and the absolute session limit.
 */
async function loadUser(req, res, next) {
  res.locals.can = () => false;
  if (!req.session || !req.session.userId) return next();

  const user = await users.findById(req.session.userId);
  const now = Date.now();
  const expired =
    now - (req.session.loginAt || 0) > config.session.maxHours * 60 * 60 * 1000 ||
    now - (req.session.lastActivity || req.session.loginAt || 0) > config.session.idleMinutes * 60 * 1000;
  if (!user || user.status !== 'active' || user.session_version !== req.session.sessionVersion || expired) {
    clearAuth(req);
    req.authEnded = expired ? 'expired' : 'revoked';
    return next();
  }

  const role = await roles.get(user.role);
  user.permissions = role ? role.permissions : new Set();
  user.roleLabel = role ? role.name : user.role;
  user.requireMfa = Boolean(role && role.require_mfa);
  if (!BACKGROUND_PATHS.has(req.path)) req.session.lastActivity = now;
  req.user = user;
  res.locals.user = user;
  res.locals.can = (permission) => can(user, permission);
  next();
}

/** Path of the page a form was sent from, if it's on this site. */
function refererPath(req) {
  try {
    const url = new URL(req.get('referer') || '');
    return url.host === req.get('host') ? url.pathname + url.search : null;
  } catch {
    return null;
  }
}

/** Only allow a same-site portal path as a post-login destination. */
function safeNext(next) {
  return typeof next === 'string' && /^\/portal(\/|$|\?)/.test(next) && !next.startsWith('//') ? next : '/portal';
}

function requireAuth(req, res, next) {
  if (req.user) return next();
  if (req.method !== 'GET') {
    // Background requests get a plain 401; a form goes to sign-in, then back to the page it was on.
    if ((req.get('accept') || '').includes('application/json') || req.get('x-csrf-token')) {
      const err = new Error('Your session has ended. Please sign in again.');
      err.status = 401;
      return next(err);
    }
    const params = new URLSearchParams({ ended: req.authEnded || 'expired', next: refererPath(req) || '/portal' });
    return res.redirect(303, `/portal/login?${params}`);
  }
  const params = new URLSearchParams({ next: req.originalUrl });
  if (req.authEnded) params.set('ended', req.authEnded);
  res.redirect(`/portal/login?${params}`);
}

/**
 * Staff whose role requires two-step sign-in must set it up before using the
 * portal. Only the set-up pages and sign-out stay reachable until they do.
 */
function requireMfaSetup(req, res, next) {
  if (!req.user || req.user.mfa_enabled || !req.user.requireMfa) return next();
  const allowed = ['/account/two-step', '/logout'];
  if (allowed.some((p) => req.path === p || req.path.startsWith(`${p}/`))) return next();
  res.redirect('/portal/account/two-step');
}

/** Route guard: the signed-in user must have this permission (or any of a list). */
function requirePermission(permission) {
  const any = [].concat(permission);
  return (req, res, next) => {
    if (req.user && any.some((p) => can(req.user, p))) return next();
    const err = new Error('Your role doesn’t include access to this page.');
    err.status = 403;
    next(err);
  };
}

module.exports = {
  loadUser,
  requireAuth,
  requireMfaSetup,
  requirePermission,
  establishSession,
  refreshSessionVersion,
  clearAuth,
  safeNext,
};
