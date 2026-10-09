'use strict';

const express = require('express');
const users = require('../../services/users');
const tokens = require('../../services/tokens');
const mfa = require('../../services/mfa');
const staffEmails = require('../../services/staffEmails');
const { audit } = require('../../services/audit');
const { establishSession, clearAuth, safeNext } = require('../../middleware/auth');
const { limiters } = require('../../middleware/security');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { loginSchema, newPasswordSchema, mfaCodeSchema, email: emailSchema } = require('../../validation/portal');

const router = express.Router();

const PENDING_MFA_MINUTES = 10;
const MAX_MFA_ATTEMPTS = 5;
const SIGN_IN_ERROR = 'The email or password is incorrect, or the account is locked or inactive. Try again, or reset your password.';

const ENDED_MESSAGES = {
  expired: 'For your security you were signed out. Please sign in again.',
  revoked: 'You were signed out because your account changed. Please sign in again.',
  'signed-out': 'You have signed out.',
};

// --- Sign in -------------------------------------------------------------

function renderLogin(req, res, { values = {}, errors = {}, status = 200 } = {}) {
  res.status(status).render('pages/portal/auth/login.njk', {
    title: 'Staff sign in',
    values,
    errors,
    next: safeNext(req.query.next || req.body?.next),
    notice: ENDED_MESSAGES[req.query.ended],
  });
}

router.get('/login', (req, res) => {
  if (req.user) return res.redirect(safeNext(req.query.next));
  renderLogin(req, res);
});

router.post('/login', limiters.login, async (req, res) => {
  const parsed = loginSchema.safeParse(req.body);
  if (!parsed.success) {
    return renderLogin(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });
  }

  const { email, password } = parsed.data;
  const result = await users.authenticate(email, password);
  if (!result.user) {
    await audit(req, {
      action: result.reason === 'locked-now' ? 'auth.locked' : 'auth.login_failed',
      entityType: 'user',
      entityId: result.userId,
      summary: result.reason === 'locked-now'
        ? `Account locked after repeated failed sign-ins (${email})`
        : `Failed sign-in for ${email}`,
      metadata: { reason: result.reason },
    });
    return renderLogin(req, res, { values: { email }, errors: { form: SIGN_IN_ERROR }, status: 401 });
  }

  const next = safeNext(req.body.next);
  const { user } = result;

  // Ask for a code only while two-step sign-in is switched on for the portal.
  if (user.mfa_enabled && (await require('../../services/security').twoStepOn())) {
    await new Promise((resolve, reject) => req.session.regenerate((err) => (err ? reject(err) : resolve())));
    req.session.pendingMfa = { userId: user.id, at: Date.now(), attempts: 0, next };
    return res.redirect(303, '/portal/login/verify');
  }

  await completeSignIn(req, user, 'password');
  res.redirect(303, next);
});

async function completeSignIn(req, user, method) {
  await establishSession(req, user);
  // Shown on the dashboard so people can spot a sign-in that wasn't theirs.
  req.session.previousLoginAt = user.last_login_at;
  await users.recordLogin(user.id);
  await audit(req, { action: 'auth.login', entityType: 'user', entityId: user.id, summary: `${user.name} signed in`, metadata: { method }, user });
}

// --- Two-step code ---------------------------------------------------------

function pendingMfa(req) {
  const p = req.session.pendingMfa;
  if (!p || Date.now() - p.at > PENDING_MFA_MINUTES * 60 * 1000) return null;
  return p;
}

router.get('/login/verify', (req, res) => {
  if (!pendingMfa(req)) return res.redirect('/portal/login?ended=expired');
  res.render('pages/portal/auth/verify.njk', { title: 'Two-step sign in', errors: {} });
});

router.post('/login/verify', limiters.login, async (req, res) => {
  const pending = pendingMfa(req);
  if (!pending) return res.redirect(303, '/portal/login?ended=expired');

  const parsed = mfaCodeSchema.safeParse(req.body);
  const method = parsed.success ? await mfa.verifyLogin(pending.userId, parsed.data.code) : null;
  const user = method ? await users.findById(pending.userId) : null;

  if (!user || user.status !== 'active') {
    pending.attempts += 1;
    await audit(req, { action: 'auth.mfa_failed', entityType: 'user', entityId: pending.userId, summary: 'Incorrect two-step code' });
    if (pending.attempts >= MAX_MFA_ATTEMPTS) {
      clearAuth(req);
      return renderLogin(req, res, { errors: { form: 'Too many incorrect codes. Please sign in again.' }, status: 401 });
    }
    return res.status(401).render('pages/portal/auth/verify.njk', {
      title: 'Two-step sign in',
      errors: { code: 'That code didn’t work. Check your app and try again, or use a recovery code.' },
    });
  }

  const next = pending.next;
  await completeSignIn(req, user, method);
  if (method === 'recovery') {
    const left = await mfa.remainingRecoveryCodes(user.id);
    setFlash(req, 'warning', `You signed in with a recovery code. You have ${left} left. If your phone is lost, set up two-step sign-in again from My account.`);
  }
  res.redirect(303, next);
});

// --- Sign out ------------------------------------------------------------

router.post('/logout', async (req, res) => {
  if (req.user) await audit(req, { action: 'auth.logout', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} signed out` });
  req.session.destroy(() => {
    res.clearCookie('hlo.sid');
    res.redirect(303, '/portal/login?ended=signed-out');
  });
});

// --- Forgot password ---------------------------------------------------------

const FORGOT_DONE = 'If that email belongs to an active staff account, we’ve sent a link to reset the password. It expires in 60 minutes.';

router.get('/forgot-password', (req, res) => {
  res.render('pages/portal/auth/forgot.njk', { title: 'Reset your password', values: {}, errors: {} });
});

router.post('/forgot-password', limiters.forms, async (req, res) => {
  const parsed = emailSchema.safeParse(req.body.email);
  if (!parsed.success) {
    return res.status(422).render('pages/portal/auth/forgot.njk', {
      title: 'Reset your password',
      values: req.body,
      errors: { email: 'Enter a valid email address.' },
    });
  }

  const user = await users.findByEmail(parsed.data);
  if (user && user.status === 'active') {
    const token = await tokens.issue(user.id, 'reset', req.ip);
    await staffEmails.passwordReset(user, token);
    await audit(req, { action: 'auth.reset_requested', entityType: 'user', entityId: user.id, summary: `Password reset requested for ${user.email}`, user });
  }
  // Same answer either way, so the form can't be used to discover staff emails.
  setFlash(req, 'success', FORGOT_DONE);
  res.redirect(303, '/portal/forgot-password');
});

// --- Set a password from an invite or reset link ---------------------------

const LINK_PAGES = {
  invite: { title: 'Set up your account', heading: 'Welcome to the HLO Staff Portal', intro: 'Choose a password to finish setting up your account.' },
  reset: { title: 'Choose a new password', heading: 'Choose a new password', intro: 'Your new password replaces the old one and signs you out everywhere else.' },
};

function linkHandlers(purpose) {
  const page = LINK_PAGES[purpose];

  const render = (res, user, { errors = {}, status = 200 } = {}) =>
    res.status(status).render('pages/portal/auth/set-password.njk', { ...page, user, errors });

  return {
    async show(req, res) {
      const row = await tokens.check(req.params.token, purpose);
      const user = row && (await users.findById(row.user_id));
      if (!user || user.status !== 'active') return res.status(410).render('pages/portal/auth/link-invalid.njk', { title: 'Link expired', purpose });
      render(res, user);
    },

    async submit(req, res) {
      const row = await tokens.check(req.params.token, purpose);
      const user = row && (await users.findById(row.user_id));
      if (!user || user.status !== 'active') return res.status(410).render('pages/portal/auth/link-invalid.njk', { title: 'Link expired', purpose });

      const parsed = newPasswordSchema(user.email).safeParse(req.body);
      if (!parsed.success) return render(res, user, { errors: fieldErrors(parsed.error), status: 422 });

      if (!(await tokens.consume(row))) return res.status(410).render('pages/portal/auth/link-invalid.njk', { title: 'Link expired', purpose });
      await users.setPassword(user.id, parsed.data.password);
      clearAuth(req);

      await audit(req, {
        action: purpose === 'invite' ? 'auth.invite_accepted' : 'auth.password_reset',
        entityType: 'user',
        entityId: user.id,
        summary: purpose === 'invite' ? `${user.name} set up their account` : `${user.name} reset their password`,
        user,
      });
      if (purpose === 'reset') await staffEmails.securityNotice(user, 'your password was reset');

      setFlash(req, 'success', purpose === 'invite' ? 'Your password is set. Please sign in.' : 'Your password has been changed. Please sign in.');
      res.redirect(303, '/portal/login');
    },
  };
}

for (const [path, purpose] of [['/invite/:token', 'invite'], ['/reset-password/:token', 'reset']]) {
  const h = linkHandlers(purpose);
  router.get(path, h.show);
  router.post(path, limiters.forms, h.submit);
}

module.exports = router;
