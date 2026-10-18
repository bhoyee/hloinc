'use strict';

const express = require('express');
const db = require('../../db/knex');
const security = require('../../services/security');
const users = require('../../services/users');
const roles = require('../../services/roles');
const notifications = require('../../services/notifications');
const { audit } = require('../../services/audit');
const { setFlash } = require('../../lib/forms');
const { limiters } = require('../../middleware/security');

const router = express.Router();
const crumbs = [{ label: 'Dashboard', href: '/portal' }];

async function render(req, res, { errors = {}, values = {}, status = 200 } = {}) {
  const on = await security.twoStepOn();
  const [linked, active] = await Promise.all([
    db('users').where({ status: 'active', mfa_enabled: true }).count({ n: '*' }).first(),
    db('users').where({ status: 'active' }).count({ n: '*' }).first(),
  ]);
  res.status(status).render('pages/portal/settings/security.njk', {
    title: 'Security settings',
    subheading: 'Portal-wide sign-in rules for every staff account.',
    crumbs,
    on,
    linked: Number(linked.n),
    active: Number(active.n),
    requiredRoles: (await roles.list()).filter((r) => r.require_mfa).map((r) => r.name),
    lastChange: await security.lastChange(),
    turnstile: await require('../../lib/turnstile').settings(),
    errors,
    values,
  });
}

router.get('/security', (req, res) => render(req, res));

router.post('/security', limiters.login, async (req, res) => {
  const want = req.body.two_step === 'on' ? true : req.body.two_step === 'off' ? false : null;
  if (want === null) return render(req, res, { errors: { two_step: 'Choose on or off.' }, status: 422 });
  if (want === (await security.twoStepOn())) {
    setFlash(req, 'info', 'Nothing changed.');
    return res.redirect(303, '/portal/settings/security');
  }
  // A change this important needs the person's password.
  if (!(await users.checkPassword(req.user.id, req.body.password))) {
    return render(req, res, { errors: { password: 'That isn’t your current password.' }, values: { two_step: req.body.two_step }, status: 422 });
  }

  await security.setTwoStep(want, req.user);
  await audit(req, {
    action: want ? 'security.two_step_on' : 'security.two_step_off',
    entityType: 'setting',
    entityId: 'two_step',
    summary: `${req.user.name} switched two-step sign-in ${want ? 'ON' : 'OFF'} for everyone`,
  });
  // Tell everyone else who can change this, so a change is never silent.
  await notifications.notifyPermission('security.edit', {
    type: 'security',
    title: `Two-step sign-in switched ${want ? 'on' : 'off'} for everyone`,
    body: `By ${req.user.name}`,
    link: '/portal/settings/security',
  }, { exceptId: req.user.id });

  setFlash(
    req,
    'success',
    want
      ? 'Two-step sign-in is on. Staff whose role requires it will be asked to set it up when they next use the portal.'
      : 'Two-step sign-in is off. Everyone now signs in with email and password only.'
  );
  res.redirect(303, '/portal/settings/security');
});

// --- Spam protection on the website forms (Cloudflare Turnstile) ---------------------------------

const KEY_FORMAT = /^[0-9A-Za-z_-]{10,200}$/;

router.post('/turnstile', limiters.login, async (req, res) => {
  const turnstile = require('../../lib/turnstile');
  const current = await turnstile.settings();
  const enabled = req.body.turnstile === 'on' ? true : req.body.turnstile === 'off' ? false : null;
  const siteKey = String(req.body.site_key || '').trim();
  const secretKey = String(req.body.secret_key || '').trim();
  const values = { turnstile: req.body.turnstile, site_key: siteKey };
  const fail = (errors) => render(req, res, { errors, values, status: 422 });

  const errors = {};
  if (enabled === null) errors.turnstile = 'Choose on or off.';
  if (siteKey && !KEY_FORMAT.test(siteKey)) errors.site_key = 'That doesn’t look like a Turnstile site key. Copy it again from Cloudflare.';
  if (secretKey && !KEY_FORMAT.test(secretKey)) errors.secret_key = 'That doesn’t look like a Turnstile secret key. Copy it again from Cloudflare.';
  if (enabled && !siteKey) errors.site_key = 'Enter the site key to switch it on.';
  if (enabled && !secretKey && !current.secretKey) errors.secret_key = 'Enter the secret key to switch it on.';
  if (Object.keys(errors).length) return fail(errors);

  const changed = enabled !== current.enabled || siteKey !== current.siteKey || Boolean(secretKey);
  if (!changed) {
    setFlash(req, 'info', 'Nothing changed.');
    return res.redirect(303, '/portal/settings/security#turnstile');
  }
  if (!(await users.checkPassword(req.user.id, req.body.turnstile_password))) return fail({ turnstile_password: 'That isn’t your current password.' });

  // A wrong secret would make every form fail, so check it with Cloudflare first.
  const secret = secretKey || current.secretKey;
  let note = '';
  if (enabled && secret) {
    const check = await turnstile.checkSecret(secret);
    if (check === 'bad') return fail({ secret_key: 'Cloudflare didn’t accept that secret key. Copy it again from your Turnstile widget.' });
    if (check === 'unreachable') note = ' Cloudflare couldn’t be reached to check the secret key; send a test message from the Contact page to make sure the form works.';
  }

  await turnstile.save({ enabled, siteKey, secretKey }, req.user);
  // The secret key itself is never logged.
  await audit(req, {
    action: enabled === current.enabled ? 'security.turnstile_keys' : enabled ? 'security.turnstile_on' : 'security.turnstile_off',
    entityType: 'setting',
    entityId: 'turnstile',
    summary: `${req.user.name} ${enabled === current.enabled ? 'changed the Turnstile keys' : `switched Turnstile spam protection ${enabled ? 'ON' : 'OFF'} on the website forms`}${secretKey ? ' (new secret key)' : ''}`,
  });
  await notifications.notifyPermission('security.edit', {
    type: 'security',
    title: enabled === current.enabled ? 'Turnstile keys changed' : `Turnstile spam protection switched ${enabled ? 'on' : 'off'}`,
    body: `By ${req.user.name}`,
    link: '/portal/settings/security#turnstile',
  }, { exceptId: req.user.id });

  setFlash(req, 'success', (enabled
    ? 'Turnstile is on. Visitors see a quick security check on every website form; most people won’t need to do anything.'
    : 'Turnstile is off. The other spam checks still protect the forms.') + note);
  res.redirect(303, '/portal/settings/security#turnstile');
});

module.exports = router;
