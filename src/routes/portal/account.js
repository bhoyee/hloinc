'use strict';

const express = require('express');
const users = require('../../services/users');
const mfa = require('../../services/mfa');
const staffEmails = require('../../services/staffEmails');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { refreshSessionVersion } = require('../../middleware/auth');
const { limiters } = require('../../middleware/security');
const { fieldErrors, setFlash } = require('../../lib/forms');
const { profileSchema, changePasswordSchema, mfaCodeSchema } = require('../../validation/portal');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];

// --- Overview, profile and password -------------------------------------------

async function renderAccount(req, res, { values, errors = {}, passwordErrors = {}, status = 200 } = {}) {
  res.status(status).render('pages/portal/account/index.njk', {
    title: 'My account',
    crumbs,
    values: values || { name: req.user.name, phone: req.user.phone || '' },
    errors,
    passwordErrors,
    mfaRequired: req.user.requireMfa,
    recoveryLeft: req.user.mfa_enabled ? await mfa.remainingRecoveryCodes(req.user.id) : 0,
  });
}

router.get('/', (req, res) => renderAccount(req, res));

router.post('/profile', async (req, res) => {
  const parsed = profileSchema.safeParse(req.body);
  if (!parsed.success) return renderAccount(req, res, { values: req.body, errors: fieldErrors(parsed.error), status: 422 });

  await users.update(req.user.id, parsed.data);
  await audit(req, { action: 'profile.update', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} updated their profile` });
  setFlash(req, 'success', 'Your details have been saved.');
  res.redirect(303, '/portal/account');
});

router.post('/password', limiters.login, async (req, res) => {
  const parsed = changePasswordSchema(req.user.email).safeParse(req.body);
  let errors = parsed.success ? {} : fieldErrors(parsed.error);
  if (parsed.success && !(await users.checkPassword(req.user.id, parsed.data.current))) {
    errors = { current: 'That isn’t your current password.' };
  } else if (parsed.success && parsed.data.current === parsed.data.password) {
    errors = { password: 'Choose a password that’s different from your current one.' };
  }
  if (Object.keys(errors).length) return renderAccount(req, res, { passwordErrors: errors, status: 422 });

  // setPassword signs out every other session; keep this one signed in.
  const updated = await users.setPassword(req.user.id, parsed.data.password);
  refreshSessionVersion(req, updated);
  await audit(req, { action: 'profile.password_change', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} changed their password` });
  await staffEmails.securityNotice(req.user, 'your password was changed');
  await notifications.notifyUser(req.user.id, { type: 'security', title: 'Your password was changed', body: 'Other devices were signed out.', link: '/portal/account' });
  setFlash(req, 'success', 'Your password has been changed. Any other devices have been signed out.');
  res.redirect(303, '/portal/account');
});

router.post('/sign-out-others', async (req, res) => {
  await users.revokeSessions(req.user.id);
  refreshSessionVersion(req, await users.findById(req.user.id));
  await audit(req, { action: 'profile.sign_out_others', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} signed out of other devices` });
  setFlash(req, 'success', 'You’ve been signed out on every other device.');
  res.redirect(303, '/portal/account');
});

// --- Two-step sign-in ----------------------------------------------------------

const SETUP_MINUTES = 15;

async function renderTwoStep(req, res, { errors = {}, status = 200 } = {}) {
  const required = req.user.requireMfa;
  let setup = null;
  if (!req.user.mfa_enabled && !req.user.twoStepOff) {
    // Keep the same secret while the person is setting up, so the QR code doesn't change on a typo.
    const s = req.session.mfaSetup;
    if (!s || Date.now() - s.at > SETUP_MINUTES * 60 * 1000) {
      req.session.mfaSetup = { secret: mfa.newSecret(), at: Date.now() };
    }
    setup = await mfa.enrollmentFor(req.user, req.session.mfaSetup.secret);
  }
  res.status(status).render('pages/portal/account/two-step.njk', {
    title: 'Two-step sign-in',
    crumbs: [...crumbs, { label: 'My account', href: '/portal/account' }],
    required,
    switchedOff: req.user.twoStepOff,
    setup,
    errors,
    recoveryLeft: req.user.mfa_enabled ? await mfa.remainingRecoveryCodes(req.user.id) : 0,
  });
}

router.get('/two-step', (req, res) => renderTwoStep(req, res));

router.post('/two-step/enable', limiters.login, async (req, res) => {
  if (req.user.mfa_enabled || req.user.twoStepOff) return res.redirect(303, '/portal/account/two-step');
  const s = req.session.mfaSetup;
  const parsed = mfaCodeSchema.safeParse(req.body);
  const step = s && parsed.success ? await mfa.checkCode(s.secret, parsed.data.code) : null;
  if (step == null) {
    return renderTwoStep(req, res, { errors: { code: 'That code didn’t match. Check the time on your phone is correct and try the newest code.' }, status: 422 });
  }

  const codes = await mfa.enable(req.user.id, s.secret, step);
  delete req.session.mfaSetup;
  await audit(req, { action: 'mfa.enabled', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} turned on two-step sign-in` });
  await staffEmails.securityNotice(req.user, 'two-step sign-in was turned on');
  await notifications.notifyUser(req.user.id, { type: 'security', title: 'Two-step sign-in is on', body: 'Keep your recovery codes somewhere safe.', link: '/portal/account/two-step' });
  res.render('pages/portal/account/recovery-codes.njk', { title: 'Save your recovery codes', crumbs, codes, firstTime: true });
});

/** Sensitive two-step changes need the current password. */
async function confirmPassword(req, res) {
  if (await users.checkPassword(req.user.id, req.body.password)) return true;
  await renderTwoStep(req, res, { errors: { password: 'That isn’t your current password.' }, status: 422 });
  return false;
}

router.post('/two-step/recovery-codes', limiters.login, async (req, res) => {
  if (!req.user.mfa_enabled) return res.redirect(303, '/portal/account/two-step');
  if (!(await confirmPassword(req, res))) return;
  const codes = await mfa.regenerateRecoveryCodes(req.user.id);
  await audit(req, { action: 'mfa.recovery_regenerated', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} created new recovery codes` });
  res.render('pages/portal/account/recovery-codes.njk', { title: 'Your new recovery codes', crumbs, codes, firstTime: false });
});

router.post('/two-step/disable', limiters.login, async (req, res) => {
  if (!req.user.mfa_enabled) return res.redirect(303, '/portal/account/two-step');
  if (req.user.requireMfa) {
    setFlash(req, 'error', 'Your role requires two-step sign-in, so it can’t be turned off. To move it to a new phone, create new recovery codes or ask an administrator to reset it.');
    return res.redirect(303, '/portal/account/two-step');
  }
  if (!(await confirmPassword(req, res))) return;
  await mfa.disable(req.user.id);
  await audit(req, { action: 'mfa.disabled', entityType: 'user', entityId: req.user.id, summary: `${req.user.name} turned off two-step sign-in` });
  await staffEmails.securityNotice(req.user, 'two-step sign-in was turned off');
  await notifications.notifyUser(req.user.id, { type: 'security', title: 'Two-step sign-in was turned off', link: '/portal/account/two-step' });
  setFlash(req, 'success', 'Two-step sign-in is now off.');
  res.redirect(303, '/portal/account/two-step');
});

module.exports = router;
